// Carrier Abound Data Ingestion Service (DMS) REST client.
//
// IMPORTANT: does NOT use sdk.http. The NF-provided axios instance (sdk.http)
// carries a baseURL / interceptors that mangle the external ingest POST and
// cause a spurious 401. We build our OWN transport here (a clean axios instance
// if requirable, else Node's built-in https) so the request goes out exactly as
// written — same as a plain curl.
//
// Token handling:
//   - cached to /config/.dms-token.json with expiry; reused until ~60s before expiry
//   - 401 on POST → force-refresh + single retry
//   - credential changes → clearTokenCache() (called from configure-publish on save)
//   - atomic cache writes (temp + rename) and a cross-process single-flight lock.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { URL } = require("url");

const TOKEN_CACHE = path.join(__dirname, "..", "config", ".dms-token.json");
const LOCK_PATH = TOKEN_CACHE + ".lock";
const DMS_PATH = "/v1/dms/data";

const EXPIRY_MARGIN_MS = 60 * 1000;
const LOCK_STALE_MS = 30 * 1000;
const LOCK_WAIT_MS = 200;
const LOCK_WAIT_TRIES = 25;
const REQ_TIMEOUT_MS = 30 * 1000;

// ---- Transport: a clean client that does NOT touch sdk.http ----------------
// Prefer a bare axios instance (no baseURL, no interceptors). Fall back to a
// hand-rolled https client if axios can't be required in this runtime.
let axiosClient = null;
let TRANSPORT = "https";
try {
  const axios = require("axios");
  axiosClient = axios.create({
    timeout: REQ_TIMEOUT_MS,
    maxRedirects: 0,               // never follow a redirect (would drop auth header)
    validateStatus: () => true,    // we inspect status ourselves
  });
  TRANSPORT = "axios";
} catch (_) {
  axiosClient = null;
  TRANSPORT = "https";
}

function insecureAgent(s) {
  if (s && s.dms && s.dms.verifyTls === false) {
    return new https.Agent({ rejectUnauthorized: false });
  }
  return undefined;
}

// Raw https POST/GET → { status, headers, data } (data parsed as JSON if possible).
function rawRequest(method, urlStr, { headers = {}, body = null, agent } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || 443,
      path: u.pathname + u.search,
      headers: { ...headers },
      timeout: REQ_TIMEOUT_MS,
    };
    if (agent) opts.agent = agent;
    if (body != null) opts.headers["Content-Length"] = Buffer.byteLength(body);
    const req = https.request(opts, (res) => {
      let chunks = "";
      res.on("data", (d) => (chunks += d));
      res.on("end", () => {
        let data = chunks;
        try { data = chunks ? JSON.parse(chunks) : ""; } catch (_) { /* keep raw */ }
        resolve({ status: res.statusCode, headers: res.headers, data });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    if (body != null) req.write(body);
    req.end();
  });
}

// Unified POST/GET over whichever transport is active. Returns {status, headers, data}.
async function send(method, urlStr, { headers = {}, body = null, s } = {}) {
  const agent = insecureAgent(s);
  if (axiosClient) {
    const resp = await axiosClient.request({
      method,
      url: urlStr,
      headers,
      data: body != null ? body : undefined,
      httpsAgent: agent,
    });
    return { status: resp.status, headers: resp.headers, data: resp.data };
  }
  return rawRequest(method, urlStr, { headers, body, agent });
}
// ---------------------------------------------------------------------------

function dataUrl(s) {
  const base = String(s.dms.baseUrl || "").replace(/\/+$/, "");
  return base + DMS_PATH;
}

function readTokenCache() {
  try { return JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8")); } catch (_) { return null; }
}

function writeTokenCache(tok) {
  try {
    const dir = path.dirname(TOKEN_CACHE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${TOKEN_CACHE}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(tok));
    fs.renameSync(tmp, TOKEN_CACHE);
  } catch (_) { /* best-effort */ }
}

function clearTokenCache() {
  try { fs.unlinkSync(TOKEN_CACHE); } catch (_) {}
  try { fs.unlinkSync(LOCK_PATH); } catch (_) {}
}

function freshCachedToken(now) {
  const c = readTokenCache();
  if (c && c.access_token && c.expires_at && c.expires_at - EXPIRY_MARGIN_MS > now) return c.access_token;
  return null;
}

function tryLock() {
  try { fs.closeSync(fs.openSync(LOCK_PATH, "wx")); return true; }
  catch (e) {
    if (e.code === "EEXIST") {
      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_PATH);
          return tryLock();
        }
      } catch (_) {}
      return false;
    }
    return true;
  }
}
function unlock() { try { fs.unlinkSync(LOCK_PATH); } catch (_) {} }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// NOTE: sdk kept in the signature for call-site compatibility; it is NOT used.
async function fetchToken(_sdk, s, now) {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: s.dms.clientId,
    client_secret: s.dms.clientSecret,
  });
  if (s.dms.scope) form.set("scope", s.dms.scope);

  const resp = await send("POST", s.dms.tokenUrl, {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
    s,
  });
  const body = resp.data || {};
  const accessToken = body.access_token;
  if (!accessToken) throw new Error(`token endpoint returned no access_token (status ${resp.status})`);
  const ttlMs = (Number(body.expires_in) || 3600) * 1000;
  writeTokenCache({ access_token: accessToken, expires_at: now + ttlMs });
  return accessToken;
}

async function getToken(sdk, s, force = false) {
  if (!force) { const t = freshCachedToken(Date.now()); if (t) return t; }
  let haveLock = tryLock();
  if (!haveLock) {
    for (let i = 0; i < LOCK_WAIT_TRIES; i++) {
      await sleep(LOCK_WAIT_MS);
      const t = freshCachedToken(Date.now());
      if (t) return t;
      if (tryLock()) { haveLock = true; break; }
    }
  }
  try {
    if (!force) { const t = freshCachedToken(Date.now()); if (t) return t; }
    return await fetchToken(sdk, s, Date.now());
  } finally {
    if (haveLock) unlock();
  }
}

async function ping(sdk, s) {
  const token = await getToken(sdk, s);
  const resp = await send("GET", dataUrl(s), { headers: { Authorization: `Bearer ${token}` }, s });
  return { status: resp.status, data: resp.data };
}

// POST one site's body. Refreshes the token once on 401. Throws on other errors;
// the caller handles 413 (payload too large) by chunking.
async function postData(sdk, s, body, _retried = false) {
  const token = await getToken(sdk, s);
  const url = dataUrl(s);
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  const resp = await send("POST", url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json;charset=UTF-8",
    },
    body: payload,
    s,
  });

  if (resp.status >= 200 && resp.status < 300) {
    return { status: resp.status, data: resp.data };
  }
  if (resp.status === 401 && !_retried) {
    await getToken(sdk, s, true); // force refresh
    return postData(sdk, s, body, true);
  }
  const err = new Error(`DMS POST failed: ${resp.status} (transport=${TRANSPORT})`);
  err.status = resp.status;
  err.body = resp.data;
  // TEMP: surface the real response so a non-2xx is diagnosable. Remove later.
  console.log("DMS_RESP " + JSON.stringify({
    transport: TRANSPORT, url, status: resp.status, data: resp.data,
    wwwAuth: resp.headers && (resp.headers["www-authenticate"] || resp.headers["WWW-Authenticate"]),
  }));
  throw err;
}

module.exports = { getToken, ping, postData, dataUrl, clearTokenCache, DMS_PATH };

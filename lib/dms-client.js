// Carrier Abound Data Ingestion Service (DMS) REST client.
// Uses sdk.http (Axios, provided to hooks) for the OAuth2 token fetch and the
// data POST. External absolute URLs override sdk.http's NF baseURL.
//
// Token handling:
//   - cached to /config/.dms-token.json with expiry; reused until ~60s before expiry
//   - 401 on POST → force-refresh + single retry
//   - credential changes → clearTokenCache() (called from configure-publish on save)
//   - atomic cache writes (temp + rename) and a cross-process single-flight lock,
//     so the per-site streaming invocations don't stampede the IdP or corrupt the
//     cache file at portfolio scale.

const fs = require("fs");
const path = require("path");

const TOKEN_CACHE = path.join(__dirname, "..", "config", ".dms-token.json");
const LOCK_PATH = TOKEN_CACHE + ".lock";
const DMS_PATH = "/v1/dms/data";

const EXPIRY_MARGIN_MS = 60 * 1000;   // refresh this long before expiry
const LOCK_STALE_MS = 30 * 1000;      // treat a lock older than this as abandoned
const LOCK_WAIT_MS = 200;             // poll interval while another fetch is in flight
const LOCK_WAIT_TRIES = 25;           // ~5s total

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function dataUrl(s) {
  const base = String(s.dms.baseUrl || "").replace(/\/+$/, "");
  return base + DMS_PATH;
}

// Optional per-request config to skip TLS verification (test only).
function reqConfig(s, extra = {}) {
  const cfg = { ...extra };
  if (s.dms && s.dms.verifyTls === false) {
    try {
      const https = require("https");
      cfg.httpsAgent = new https.Agent({ rejectUnauthorized: false });
    } catch (_) { /* ignore */ }
  }
  return cfg;
}

function readTokenCache() {
  try { return JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8")); } catch (_) { return null; }
}

// Atomic write: write a per-process temp file then rename over the cache.
function writeTokenCache(tok) {
  try {
    const dir = path.dirname(TOKEN_CACHE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${TOKEN_CACHE}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(tok));
    fs.renameSync(tmp, TOKEN_CACHE);
  } catch (_) { /* cache is best-effort */ }
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

// Exclusive-create lock; steals an abandoned (stale) lock. Returns true if held.
function tryLock() {
  try {
    fs.closeSync(fs.openSync(LOCK_PATH, "wx"));
    return true;
  } catch (e) {
    if (e.code === "EEXIST") {
      try {
        if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
          fs.unlinkSync(LOCK_PATH);
          return tryLock();
        }
      } catch (_) {}
      return false;
    }
    return true; // locking unavailable → proceed without it
  }
}
function unlock() { try { fs.unlinkSync(LOCK_PATH); } catch (_) {} }

async function fetchToken(sdk, s, now) {
  const form = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: s.dms.clientId,
    client_secret: s.dms.clientSecret,
  });
  if (s.dms.scope) form.set("scope", s.dms.scope);

  const resp = await sdk.http.post(
    s.dms.tokenUrl,
    form.toString(),
    reqConfig(s, { headers: { "Content-Type": "application/x-www-form-urlencoded" } }),
  );
  const body = resp.data || {};
  const accessToken = body.access_token;
  if (!accessToken) throw new Error("token endpoint returned no access_token");
  const ttlMs = (Number(body.expires_in) || 3600) * 1000;
  writeTokenCache({ access_token: accessToken, expires_at: now + ttlMs });
  return accessToken;
}

// OAuth2 client-credentials with single-flight. force=true bypasses the cache
// (used by the 401 retry).
async function getToken(sdk, s, force = false) {
  if (!force) { const t = freshCachedToken(Date.now()); if (t) return t; }

  let haveLock = tryLock();
  if (!haveLock) {
    // Another invocation is fetching — wait for it to populate the cache.
    for (let i = 0; i < LOCK_WAIT_TRIES; i++) {
      await sleep(LOCK_WAIT_MS);
      const t = freshCachedToken(Date.now());
      if (t) return t;
      if (tryLock()) { haveLock = true; break; } // it gave up / crashed → take over
    }
  }
  try {
    if (!force) { const t = freshCachedToken(Date.now()); if (t) return t; } // double-check under lock
    return await fetchToken(sdk, s, Date.now());
  } finally {
    if (haveLock) unlock();
  }
}

// GET /v1/dms/data — service availability / auth probe.
async function ping(sdk, s) {
  const token = await getToken(sdk, s);
  const resp = await sdk.http.get(
    dataUrl(s),
    reqConfig(s, { headers: { Authorization: `Bearer ${token}` } }),
  );
  return { status: resp.status, data: resp.data };
}

// POST one site's body. Refreshes the token once on 401. Throws on other errors;
// the caller handles 413 (payload too large) by chunking.
async function postData(sdk, s, body, _retried = false) {
  const token = await getToken(sdk, s);
  try {
    const resp = await sdk.http.post(
      dataUrl(s),
      body,
      reqConfig(s, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json;charset=UTF-8" },
      }),
    );
    return { status: resp.status, data: resp.data };
  } catch (e) {
    const status = e.response && e.response.status;
    if (status === 401 && !_retried) {
      await getToken(sdk, s, true); // force refresh
      return postData(sdk, s, body, true);
    }
    const err = new Error(`DMS POST failed: ${status || e.message}`);
    err.status = status;
    err.body = e.response && e.response.data;
    throw err;
  }
}

module.exports = { getToken, ping, postData, dataUrl, clearTokenCache, DMS_PATH };

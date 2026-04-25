// Auth + fetch helpers for the Abound dashboard.

export function getAuthToken() {
  const params = new URLSearchParams(window.location.search);
  let token = params.get("token") || params.get("auth_token");
  if (!token && window.location.hash) {
    const hp = new URLSearchParams(window.location.hash.substring(1));
    token = hp.get("token") || hp.get("auth_token");
  }
  return token;
}

function authHeaders(extra = {}) {
  const h = { ...extra };
  const tok = getAuthToken();
  if (tok) h["Authorization"] = `Bearer ${tok}`;
  return h;
}

async function throwIfAuth(r) {
  if (r.status === 401 || r.status === 403) {
    console.warn("[abound] auth failed, reloading");
    window.location.reload();
    throw new Error("auth failed");
  }
}

export async function apiGet(path, params) {
  let url = `${window.location.origin}${path}`;
  if (params) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => qs.append(k, x));
      else if (v !== undefined && v !== null) qs.append(k, v);
    }
    url += (url.includes("?") ? "&" : "?") + qs.toString();
  }
  const r = await fetch(url, { headers: authHeaders() });
  await throwIfAuth(r);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}: ${await r.text()}`);
  return r.json();
}

export async function apiPost(path, body, contentType = "application/json") {
  const r = await fetch(`${window.location.origin}${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": contentType }),
    body: JSON.stringify(body === undefined ? {} : body),
  });
  await throwIfAuth(r);
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`POST ${path} → ${r.status}: ${txt || r.statusText}`);
  }
  const txt = await r.text();
  if (!txt) return {};
  try { return JSON.parse(txt); } catch (_) { return { raw: txt }; }
}

export const APP_ID = "abound";

function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function b64ToUtf8(b) {
  const bin = atob(b);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// Read a file. Tries a few response shapes so tunnel/proxy differences don't
// silently produce null (which would be interpreted as "file doesn't exist").
// Returns a UTF-8 string on success, `null` on 404, or throws on any other error.
export async function readFile(path) {
  const url = `${window.location.origin}/api/v1/apps/${APP_ID}/files${path}`;
  const r = await fetch(url, { headers: authHeaders() });
  await throwIfAuth(r);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`readFile ${path} → ${r.status}: ${await r.text()}`);

  const txt = await r.text();
  if (!txt) throw new Error(`readFile ${path}: empty body`);

  // Try: JSON object with `data` (base64) — the expected shape.
  try {
    const js = JSON.parse(txt);
    if (js && typeof js.data === "string") {
      try { return b64ToUtf8(js.data); } catch (_) { return js.data; }
    }
    // Some proxies may deliver the content already decoded as `.content` or `.body`.
    if (js && typeof js.content === "string") return js.content;
    if (js && typeof js.body === "string") return js.body;
    // Could be JSON content itself (unlikely, but don't lose data):
    throw new Error(`readFile ${path}: unexpected JSON shape: ${Object.keys(js || {}).join(",")}`);
  } catch (e) {
    if (e.message && e.message.startsWith("readFile ")) throw e;
    // Fall through: response was not JSON. Treat as raw body only if it looks textual.
    return txt;
  }
}

// Write a file. NF's file API is gRPC-transcoded with body: "data" — the
// HTTP body is a JSON-encoded `data` scalar (base64 string).
export async function writeFile(path, content) {
  const b64 = utf8ToB64(content);
  const r = await fetch(`${window.location.origin}/api/v1/apps/${APP_ID}/files${path}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(b64),
  });
  await throwIfAuth(r);
  if (!r.ok) throw new Error(`writeFile ${path} → ${r.status}: ${await r.text()}`);
}

export async function listHooks() {
  const d = await apiGet(`/api/v1/apps`);
  const app = (d.applications || []).find((a) => a.id === APP_ID);
  if (!app) return [];
  return app.hooks || [];
}

// StartHook uses proto body: "args". Use application/grpc-web+json so the
// tunnel treats this as the canonical gRPC-transcode path.
export async function startHook(hookId, args) {
  return apiPost(
    `/api/v1/apps/${APP_ID}/hooks/${hookId}`,
    args || {},
    "application/grpc-web+json",
  );
}

export async function getHookRuns(hookId, pageSize = 5) {
  return apiGet(`/api/v1/apps/${APP_ID}/hooks/${hookId}/runs`, { pageSize });
}

export async function getHookEvents(hookId, pageSize = 50) {
  return apiGet(`/api/v1/apps/${APP_ID}/hooks/${hookId}/events`, { pageSize });
}

export async function listSites() {
  const d = await apiGet(`/api/v1/sites`, { pageSize: 500 });
  return d.sites || [];
}

export function showToast(kind, msg, ms = 4000) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.className = `fixed top-6 right-6 max-w-md rounded-md px-4 py-3 shadow-lg toast-${kind}`;
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), ms);
}

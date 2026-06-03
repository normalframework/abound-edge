import * as U from "./utils.js";

const DEFAULT_SETTINGS = {
  version: 2,
  dms: { baseUrl: "", tokenUrl: "", clientId: "", clientSecret: "", scope: "", systemId: "", verifyTls: true },
  schedule: { staleThresholdMin: 30 },
  sites: {},
};

const MAP_HEADER = ["list_id", "point_count", "raw_value", "source_label", "target_value", "target_label"];
const PT_HEADER = ["site", "equip", "point", "list_id", "states"];

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  defaultMapping: { nfTypeToCarrier: {} },
  userMapping: { nfTypeToCarrier: {} },
  enumConv: {},
  enumExport: { lists: [], points: [] },
  enumCsv: "",
  sites: [],
  hooks: [],
  activeTab: "status",
  settingsLoaded: false,
  mappingLoaded: false,
};

const HOOKS_OF_INTEREST = ["publish-data", "test-publish", "export-enum-map", "import-enum-map"];

function safeName(s) { return String(s).replace(/[^a-z0-9._-]/gi, "_"); }

async function load() {
  const [settingsRaw, defaultMapRaw, userMapRaw, enumRaw, sites, hooks] = await Promise.all([
    U.readFile("/config/settings.json").catch((e) => { console.error("readFile settings", e); return undefined; }),
    U.readFile("/config/default-mapping.json").catch(() => null),
    U.readFile("/config/mapping.json").catch((e) => { console.error("readFile mapping", e); return undefined; }),
    U.readFile("/config/enum-conversions.json").catch(() => null),
    U.listSites().catch(() => []),
    U.listHooks().catch(() => []),
  ]);

  if (typeof settingsRaw === "string") {
    try { state.settings = mergeSettings(JSON.parse(settingsRaw)); state.settingsLoaded = true; }
    catch (e) { console.error("[abound] settings parse error:", e, "raw:", settingsRaw); }
  } else if (settingsRaw === null) {
    state.settingsLoaded = true;
  } else {
    console.error("[abound] settings read failed — Save disabled");
  }

  if (typeof userMapRaw === "string") {
    try { state.userMapping = JSON.parse(userMapRaw); state.mappingLoaded = true; } catch (_) {}
  } else if (userMapRaw === null) {
    state.mappingLoaded = true;
  }
  if (defaultMapRaw) { try { state.defaultMapping = JSON.parse(defaultMapRaw); } catch (_) {} }
  if (enumRaw) { try { state.enumConv = JSON.parse(enumRaw); } catch (_) {} }
  if (!state.userMapping.nfTypeToCarrier) state.userMapping.nfTypeToCarrier = {};

  state.sites = sites;
  state.hooks = hooks;
}

function mergeSettings(user) {
  const s = structuredClone(DEFAULT_SETTINGS);
  s.dms = Object.assign(s.dms, user.dms || {});
  s.schedule = Object.assign(s.schedule, user.schedule || {});
  s.sites = user.sites || {};
  s.version = user.version || s.version;
  return s;
}

function hookByName(name) { return state.hooks.find((h) => h.name === name); }
function dmsConfigured(s) {
  const d = s.dms || {};
  return !!(d.baseUrl && d.tokenUrl && d.clientId && d.clientSecret && d.systemId);
}
function siteName(id) {
  const c = state.settings.sites[id];
  if (c && c.name) return c.name;
  const s = state.sites.find((x) => x.id === id);
  return (s && s.name) || id;
}
function enabledSiteIds() {
  return Object.keys(state.settings.sites).filter((id) => state.settings.sites[id].enabled === true);
}

function renderStatus() {
  const s = state.settings;
  const cfg = byId("statusConfig");
  const configured = dmsConfigured(s);
  const loadPill = state.settingsLoaded ? ""
    : '<div><span class="pill pill-err">settings failed to load — Save is disabled</span></div>';
  cfg.innerHTML = `
    ${loadPill}
    <div>${configured ? '<span class="pill pill-ok">Configured</span>' : '<span class="pill pill-warn">Not configured</span>'}</div>
    <div><b>Endpoint:</b> ${escapeHtml(s.dms.baseUrl || "?")}<span class="text-gray-400">/v1/dms/data</span></div>
    <div><b>System ID:</b> ${escapeHtml(s.dms.systemId || "?")}</div>
    <div><b>Token URL:</b> ${escapeHtml(s.dms.tokenUrl || "?")}</div>
    <div><b>Verify TLS:</b> ${s.dms.verifyTls === false ? "no (test)" : "yes"}</div>
  `;

  const enabled = enabledSiteIds();
  byId("statusDiscovery").innerHTML = `
    <div><b>Sites total:</b> ${state.sites.length}</div>
    <div><b>Sites enabled:</b> ${enabled.length}</div>
    <div><b>Class mapping overrides:</b> ${Object.keys(state.userMapping.nfTypeToCarrier || {}).length}</div>
    <div><b>Enum conversions:</b> ${Object.keys(state.enumConv).length}</div>
  `;
  loadRecentRuns();
}

async function loadRecentRuns() {
  const tbody = byId("recentRuns");
  tbody.innerHTML = '<tr><td colspan="3" class="text-gray-400">Loading&hellip;</td></tr>';
  const items = [];
  for (const name of HOOKS_OF_INTEREST) {
    const h = hookByName(name);
    if (!h) continue;
    try {
      const r = await U.getHookRuns(h.id, 1);
      const run = (r.runs || [])[0];
      if (run) items.push({ name, state: run.state, started: run.startTime || run.startedAt });
    } catch (_) {}
  }
  tbody.innerHTML = items.length
    ? items.map((r) => `<tr><td>${r.name}</td><td>${stateBadge(r.state)}</td><td class="text-gray-500">${fmtTime(r.started)}</td></tr>`).join("")
    : '<tr><td colspan="3" class="text-gray-400">No runs yet</td></tr>';
}

function stateBadge(s) {
  const STATES = {
    1: ["pill-muted", "new"], 2: ["pill-muted", "pending"], 3: ["pill-muted", "running"],
    4: ["pill-warn", "stopping"], 5: ["pill-warn", "stopped"],
    6: ["pill-ok", "success"], 9: ["pill-err", "error"],
  };
  const [cls, txt] = STATES[s] || ["pill-muted", String(s)];
  return `<span class="pill ${cls}">${txt}</span>`;
}
function fmtTime(t) { if (!t) return ""; try { return new Date(t).toLocaleString(); } catch (_) { return t; } }

function renderSetup() {
  const d = state.settings.dms;
  byId("dms-baseurl").value = d.baseUrl || "";
  byId("dms-tokenurl").value = d.tokenUrl || "";
  byId("dms-clientid").value = d.clientId || "";
  byId("dms-clientsecret").value = d.clientSecret || "";
  byId("dms-scope").value = d.scope || "";
  byId("dms-systemid").value = d.systemId || "";
  byId("dms-verifytls").checked = d.verifyTls !== false;
  byId("sched-stale").value = state.settings.schedule.staleThresholdMin ?? 30;
}

function readSetup() {
  const d = state.settings.dms;
  d.baseUrl = byId("dms-baseurl").value.trim();
  d.tokenUrl = byId("dms-tokenurl").value.trim();
  d.clientId = byId("dms-clientid").value.trim();
  d.clientSecret = byId("dms-clientsecret").value;
  d.scope = byId("dms-scope").value.trim();
  d.systemId = byId("dms-systemid").value.trim();
  d.verifyTls = byId("dms-verifytls").checked;
  state.settings.schedule.staleThresholdMin = parseInt(byId("sched-stale").value, 10) || 30;
}

function setSite(id, enabled) {
  const s = state.sites.find((x) => x.id === id);
  state.settings.sites[id] = { enabled, name: (s && s.name) || id };
}

function renderSites() {
  const tbody = byId("sitesTable");
  tbody.innerHTML = state.sites.map((site) => {
    const cfg = state.settings.sites[site.id] || {};
    return `<tr>
      <td><input type="checkbox" data-site="${escapeHtml(site.id)}" ${cfg.enabled === true ? "checked" : ""} /></td>
      <td class="font-mono text-xs">${escapeHtml(site.id)}</td>
      <td>${escapeHtml(site.name || "")}</td>
      <td class="text-gray-500">${escapeHtml(site.timezone || "")}</td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll('input[type=checkbox][data-site]').forEach((cb) => {
    cb.addEventListener("change", (e) => setSite(e.target.dataset.site, e.target.checked));
  });
}

function renderMapping() {
  const def = state.defaultMapping.nfTypeToCarrier || {};
  const user = state.userMapping.nfTypeToCarrier || {};
  const keys = new Set([...Object.keys(def), ...Object.keys(user)]);
  const tbody = byId("mappingTable");
  tbody.innerHTML = "";
  for (const k of [...keys].sort()) {
    const isOverride = k in user;
    const val = user[k] ?? def[k];
    const tr = document.createElement("tr");
    if (!isOverride) tr.classList.add("default-row");
    tr.innerHTML = `
      <td class="font-mono text-xs">${escapeHtml(k)}</td>
      <td><input value="${escapeHtml(val || "")}" data-map-key="${escapeHtml(k)}" /></td>
      <td>${isOverride
        ? `<button class="link" data-remove-map="${escapeHtml(k)}">Reset to default</button>`
        : '<span class="text-xs text-gray-400">default</span>'}</td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("input[data-map-key]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const k = e.target.dataset.mapKey;
      const v = e.target.value.trim();
      if (!v) delete state.userMapping.nfTypeToCarrier[k];
      else state.userMapping.nfTypeToCarrier[k] = v;
    });
  });
  tbody.querySelectorAll("button[data-remove-map]").forEach((b) => {
    b.addEventListener("click", (e) => { delete state.userMapping.nfTypeToCarrier[e.target.dataset.removeMap]; renderMapping(); });
  });
}

// ---- Enums tab -------------------------------------------------------------

function renderEnumStatus() {
  const n = Object.keys(state.enumConv).length;
  const lists = state.enumExport.lists.length ? new Set(state.enumExport.lists.map((r) => r.list_id)).size : 0;
  const note = lists ? ` <span class="text-gray-500">· workbook ready (${lists} lists, ${state.enumExport.points.length} points)</span>` : "";
  byId("enumStatus").innerHTML = (n
    ? `<span class="pill pill-ok">${n} conversion${n === 1 ? "" : "s"} active</span>`
    : '<span class="pill pill-muted">No enum conversions yet</span>') + note;
}

async function loadEnumExport() {
  const raw = await U.readFile("/config/enum-export.json").catch(() => null);
  if (raw) { try { state.enumExport = JSON.parse(raw); } catch (_) { state.enumExport = { lists: [], points: [] }; } }
  state.enumCsv = (await U.readFile("/config/enum-map.csv").catch(() => null)) || "";
  const dl = byId("btnEnumDownload");
  if (dl) dl.disabled = !(state.enumExport.lists.length || state.enumCsv);
}

async function refreshEnums() {
  const raw = await U.readFile("/config/enum-conversions.json").catch(() => null);
  state.enumConv = {};
  if (raw) { try { state.enumConv = JSON.parse(raw); } catch (_) {} }
  await loadEnumExport();
  renderEnumStatus();
}

async function generateEnums() {
  const run = await runHook("export-enum-map");
  if (!run || run.state !== 6) return;
  await loadEnumExport();
  renderEnumStatus();
  U.showToast(state.enumExport.lists.length ? "success" : "error",
    state.enumExport.lists.length ? "Workbook generated — click Download" : "No enum points found (Point.enum empty)");
}

function buildWorkbook() {
  const XLSX = window.XLSX;
  const wb = XLSX.utils.book_new();
  const mapAoa = [MAP_HEADER.slice()].concat(
    state.enumExport.lists.map((r) => [r.list_id, r.point_count, r.raw_value, r.source_label, "", ""]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(mapAoa), "Mappings");
  const ptAoa = [PT_HEADER.slice()].concat(
    state.enumExport.points.map((r) => [r.site, r.equip, r.point, r.list_id, r.states]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ptAoa), "Points");
  return wb;
}

function downloadEnums() {
  try {
    if (window.XLSX && state.enumExport.lists.length) {
      window.XLSX.writeFile(buildWorkbook(), "abound-enum-map.xlsx");
      return;
    }
    if (!state.enumCsv) { U.showToast("error", "Click '1 · Generate' first"); return; }
    const url = URL.createObjectURL(new Blob([state.enumCsv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = "abound-enum-map.csv"; a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 5000);
  } catch (e) { console.error("[abound] download failed", e); U.showToast("error", `Download failed: ${e.message}`); }
}

const csvEsc = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function aoaToCsv(aoa) {
  const norm = (c) => String(c === null || c === undefined ? "" : c).trim().toLowerCase();
  let hi = aoa.findIndex((row) => Array.isArray(row) && row.some((c) => norm(c) === "list_id"));
  if (hi < 0) hi = 0;
  const header = (aoa[hi] || []).map(norm);
  const idx = {};
  MAP_HEADER.forEach((h) => { idx[h] = header.indexOf(h); });
  const lines = [MAP_HEADER.join(",")];
  for (let i = hi + 1; i < aoa.length; i++) {
    const r = aoa[i];
    if (!Array.isArray(r) || !r.some((c) => norm(c) !== "")) continue;
    lines.push(MAP_HEADER.map((h) => csvEsc(idx[h] >= 0 ? r[idx[h]] : "")).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

async function importEnums() {
  const f = byId("enumFile").files[0];
  if (!f) { U.showToast("error", "Choose a file first"); return; }
  let csv;
  try {
    if (window.XLSX && /\.xlsx$/i.test(f.name)) {
      const wb = window.XLSX.read(await f.arrayBuffer(), { type: "array" });
      const sheet = wb.Sheets["Mappings"] || wb.Sheets[wb.SheetNames[0]];
      csv = aoaToCsv(window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }));
    } else {
      csv = await f.text();
    }
  } catch (e) { U.showToast("error", `Could not read file: ${e.message}`); return; }
  const run = await runHook("import-enum-map", { csv });
  if (run && run.state === 6) await refreshEnums();
}

// ---- Preview (dropdown, one site at a time) --------------------------------

function refreshPreview() {
  const sel = byId("previewSite");
  const ids = enabledSiteIds();
  const prev = sel.value;
  if (!ids.length) {
    sel.innerHTML = "";
    byId("previewUrl").textContent = "";
    byId("previewBodies").innerHTML = '<div class="text-sm text-gray-400">No enabled sites.</div>';
    return;
  }
  sel.innerHTML = ids.map((id) => `<option value="${escapeHtml(id)}">${escapeHtml(siteName(id))} — ${escapeHtml(id)}</option>`).join("");
  sel.value = ids.includes(prev) ? prev : ids[0];
  renderPreviewSite(sel.value);
}

async function renderPreviewSite(siteRef) {
  const box = byId("previewBodies");
  const urlEl = byId("previewUrl");
  if (!siteRef) { box.innerHTML = ""; urlEl.textContent = ""; return; }
  box.innerHTML = '<div class="text-sm text-gray-400">Loading&hellip;</div>';
  const raw = await U.readFile(`/config/.last-data-${safeName(siteRef)}.json`).catch(() => null);
  if (!raw) {
    urlEl.textContent = "";
    box.innerHTML = `<div class="text-sm text-gray-400">No recent publish for <b>${escapeHtml(siteRef)}</b>. Click <em>Publish now</em>.</div>`;
    return;
  }
  let rec; try { rec = JSON.parse(raw); } catch (_) { box.innerHTML = '<div class="text-sm text-red-600">Could not parse preview file.</div>'; return; }
  urlEl.textContent = rec.url || "";
  const body = rec.body || {};
  const post = { systemId: body.systemId, data: body.data || [] };
  box.innerHTML = `
    <div class="text-sm text-gray-500 mb-1">${escapeHtml(siteRef)} — ${post.data.length} equipment · ${escapeHtml(fmtTime(rec.ts))}</div>
    <pre class="mono-block max-h-[32rem] overflow-auto">${escapeHtml(JSON.stringify(post, null, 2))}</pre>`;
}

async function refreshLogs() {
  const box = byId("logsContent");
  box.innerHTML = '<div class="text-xs text-gray-600">Hook-run state. Payload bodies live in the Preview tab.</div>';
  for (const n of HOOKS_OF_INTEREST) {
    const h = hookByName(n);
    if (!h) continue;
    const r = await U.getHookRuns(h.id, 5).catch(() => ({ runs: [] }));
    const rows = (r.runs || []).slice(0, 5).map((run) => `
      <div class="text-xs">${stateBadge(run.state)} pid=${run.pid}
        <span class="text-gray-500">${fmtTime(run.startTime || run.startedAt)}</span>
        ${run.message ? ` · ${escapeHtml(run.message)}` : ""}</div>`).join("");
    box.innerHTML += `<div class="mt-3"><div class="font-semibold text-primary-dark-purple">${n}</div>${rows || '<div class="text-xs text-gray-400">no runs</div>'}</div>`;
  }
}

function byId(id) { return document.getElementById(id); }

function setTab(name) {
  state.activeTab = name;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.add("hidden"));
  byId(`panel-${name}`).classList.remove("hidden");
  if (name === "status") renderStatus();
  if (name === "setup") renderSetup();
  if (name === "sites") renderSites();
  if (name === "mapping") renderMapping();
  if (name === "enums") refreshEnums();
  if (name === "preview") refreshPreview();
  if (name === "logs") refreshLogs();
}

async function saveAll() {
  if (!state.settingsLoaded) {
    U.showToast("error", "Cannot save — settings file could not be loaded. Reload the page.");
    return;
  }
  readSetup();
  const d = state.settings.dms;
  const missing = [];
  if (!d.baseUrl) missing.push("Base URL");
  if (!d.tokenUrl) missing.push("Token URL");
  if (!d.clientId) missing.push("Client ID");
  if (!d.clientSecret) missing.push("Client secret");
  if (!d.systemId) missing.push("System ID");
  if (missing.length) { U.showToast("error", `Cannot save — missing: ${missing.join(", ")}. Open the Setup tab and fill the DMS connection.`); return; }

  // Backfill site display names (used in _path and re-config).
  for (const id of Object.keys(state.settings.sites)) {
    if (!state.settings.sites[id].name) {
      const site = state.sites.find((s) => s.id === id);
      if (site && site.name) state.settings.sites[id].name = site.name;
    }
  }

  try {
    await U.writeFile("/config/settings.json", JSON.stringify(state.settings, null, 2));
  } catch (e) { U.showToast("error", `Save settings failed: ${e.message}`); return; }
  if (state.mappingLoaded || Object.keys(state.userMapping.nfTypeToCarrier || {}).length) {
    try { await U.writeFile("/config/mapping.json", JSON.stringify(state.userMapping, null, 2)); }
    catch (e) { U.showToast("error", `Save mapping failed: ${e.message}`); return; }
  }

  // Re-bind the publish hook to the enabled sites (UpdateHook re-binds live, no restart).
  await runHook("configure-publish");
  U.showToast("success", "Settings saved & publish hook reconfigured.");
  if (state.activeTab === "status") renderStatus();
}

async function runHook(name, args) {
  const h = hookByName(name);
  if (!h) { U.showToast("error", `Hook ${name} not found`); return null; }
  try {
    U.showToast("info", `Starting ${name}…`, 2000);
    await U.startHook(h.id, args);
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const r = await U.getHookRuns(h.id, 1);
      const run = (r.runs || [])[0];
      if (run && (run.state === 6 || run.state === 9)) {
        if (run.state === 6) U.showToast("success", `${name} completed`);
        else U.showToast("error", `${name} failed — see Logs`);
        return run;
      }
    }
    U.showToast("info", `${name} still running — check Logs`);
    return null;
  } catch (e) { U.showToast("error", `${name}: ${e.message}`); return null; }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wire() {
  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  byId("btnSave").addEventListener("click", saveAll);
  byId("btnTest").addEventListener("click", () => runHook("test-publish"));
  byId("btnPublishNow").addEventListener("click", async () => { await runHook("publish-data"); if (state.activeTab === "preview") refreshPreview(); });

  byId("sitesAll").addEventListener("click", () => { for (const s of state.sites) setSite(s.id, true); renderSites(); });
  byId("sitesNone").addEventListener("click", () => { for (const id of Object.keys(state.settings.sites)) setSite(id, false); renderSites(); });

  byId("btnAddMap").addEventListener("click", () => {
    const k = byId("newMapKey").value.trim();
    const v = byId("newMapVal").value.trim();
    if (!k || !v) return;
    state.userMapping.nfTypeToCarrier[k] = v;
    byId("newMapKey").value = ""; byId("newMapVal").value = "";
    renderMapping();
  });

  byId("btnEnumGenerate").addEventListener("click", generateEnums);
  byId("btnEnumDownload").addEventListener("click", downloadEnums);
  byId("btnEnumImport").addEventListener("click", importEnums);
  byId("btnRefreshPreview").addEventListener("click", refreshPreview);
  byId("previewSite").addEventListener("change", (e) => renderPreviewSite(e.target.value));
  byId("btnRefreshLogs").addEventListener("click", refreshLogs);
}

(async function main() {
  wire();
  try {
    await load();
    renderSetup();   // populate the (possibly hidden) Setup form so Save reads real values from any tab
    setTab("status");
    if (!state.settingsLoaded) U.showToast("error", "Settings failed to load — Save is disabled. Reload the page.", 8000);
  } catch (e) { U.showToast("error", `Initial load failed: ${e.message}`); console.error(e); }
})();

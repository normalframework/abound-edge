import * as U from "./utils.js";

const DEFAULT_SETTINGS = {
  version: 1,
  broker: { host: "", port: 5083, tls: true, username: "", password: "", caPem: null, insecure: false },
  identity: { assetGroupId: "", edgeDeviceId: "", accId: "", subId: "" },
  org: { id: "", name: "", contact: "", email: "", info: {} },
  mode: "modeled",
  schedule: { publishIntervalMin: 15, metadataIntervalHr: 24, staleThresholdMin: 30 },
  sites: {},
};

const state = {
  settings: structuredClone(DEFAULT_SETTINGS),
  defaultMapping: { nfTypeToCarrier: {}, bacnetVendorToCarrier: {} },
  userMapping: { nfTypeToCarrier: {}, bacnetVendorToCarrier: {} },
  sites: [],
  hooks: [],
  activeTab: "status",
  settingsLoaded: false,
  mappingLoaded: false,
};

async function load() {
  const [settingsRaw, defaultMapRaw, userMapRaw, sites, hooks] = await Promise.all([
    U.readFile("/config/settings.json").catch((e) => { console.error("readFile settings", e); return undefined; }),
    U.readFile("/config/default-mapping.json").catch(() => null),
    U.readFile("/config/mapping.json").catch((e) => { console.error("readFile mapping", e); return undefined; }),
    U.listSites().catch(() => []),
    U.listHooks().catch(() => []),
  ]);

  if (typeof settingsRaw === "string") {
    try {
      state.settings = Object.assign(structuredClone(DEFAULT_SETTINGS), JSON.parse(settingsRaw));
      state.settingsLoaded = true;
      console.log("[abound] settings loaded:", state.settings);
    } catch (e) {
      console.error("[abound] settings parse error:", e, "raw:", settingsRaw);
    }
  } else if (settingsRaw === null) {
    console.log("[abound] settings file not found (new install)");
    state.settingsLoaded = true;
  } else {
    console.error("[abound] settings read failed — Save disabled");
  }

  if (typeof userMapRaw === "string") {
    try { state.userMapping = JSON.parse(userMapRaw); state.mappingLoaded = true; } catch (_) {}
  } else if (userMapRaw === null) {
    state.mappingLoaded = true;
  }

  if (defaultMapRaw) {
    try { state.defaultMapping = JSON.parse(defaultMapRaw); } catch (_) {}
  }
  state.sites = sites;
  state.hooks = hooks;
}

function hookByName(name) { return state.hooks.find((h) => h.name === name); }

function renderStatus() {
  const s = state.settings;
  const cfg = byId("statusConfig");
  const configured = !!(s.broker.host && s.identity.assetGroupId && s.identity.edgeDeviceId);
  const loadPill = state.settingsLoaded
    ? ""
    : '<div><span class="pill pill-err">settings failed to load — Save is disabled</span></div>';
  cfg.innerHTML = `
    ${loadPill}
    <div>${configured ? '<span class="pill pill-ok">Configured</span>' : '<span class="pill pill-warn">Not configured</span>'}</div>
    <div><b>Broker:</b> ${s.broker.tls ? "mqtts" : "mqtt"}://${escapeHtml(s.broker.host || "?")}:${s.broker.port}</div>
    <div><b>Asset Group:</b> ${escapeHtml(s.identity.assetGroupId || "?")}</div>
    <div><b>Controller (<code>_conID</code>):</b> ${escapeHtml(s.identity.edgeDeviceId || "?")}</div>
    <div><b>Mode:</b> ${s.mode}</div>
  `;

  const enabled = Object.keys(s.sites).filter((id) => s.sites[id].enabled === true);
  const disc = byId("statusDiscovery");
  disc.innerHTML = `
    <div><b>Sites total:</b> ${state.sites.length}</div>
    <div><b>Sites enabled:</b> ${enabled.length}</div>
    <div><b>Mapping overrides:</b> ${Object.keys(state.userMapping.nfTypeToCarrier || {}).length}</div>
  `;

  loadRecentRuns();
}

async function loadRecentRuns() {
  const tbody = byId("recentRuns");
  tbody.innerHTML = '<tr><td colspan="3" class="text-gray-400">Loading&hellip;</td></tr>';
  const items = [];
  const hooksOfInterest = ["publish-data", "publish-metadata", "test-publish", "publish-now", "publish-metadata-now"];
  for (const name of hooksOfInterest) {
    const h = hookByName(name);
    if (!h) continue;
    try {
      const r = await U.getHookRuns(h.id, 1);
      const run = (r.runs || [])[0];
      if (run) items.push({ name, state: run.state, started: run.startTime || run.startedAt });
    } catch (_) {}
  }
  tbody.innerHTML = items.length
    ? items.map((r) => `<tr>
        <td>${r.name}</td>
        <td>${stateBadge(r.state)}</td>
        <td class="text-gray-500">${fmtTime(r.started)}</td>
      </tr>`).join("")
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
function fmtTime(t) {
  if (!t) return "";
  try { return new Date(t).toLocaleString(); } catch (_) { return t; }
}

function renderSetup() {
  const s = state.settings;
  byId("broker-host").value = s.broker.host || "";
  byId("broker-port").value = s.broker.port ?? 5083;
  byId("broker-tls").checked = !!s.broker.tls;
  byId("broker-insecure").checked = !!s.broker.insecure;
  byId("broker-username").value = s.broker.username || "";
  byId("broker-password").value = s.broker.password || "";
  byId("broker-capem").value = s.broker.caPem || "";

  byId("id-ag").value = s.identity.assetGroupId || "";
  byId("id-edge").value = s.identity.edgeDeviceId || "";
  byId("id-acc").value = s.identity.accId || "";
  byId("id-sub").value = s.identity.subId || "";

  byId("org-id").value = s.org.id || "";
  byId("org-name").value = s.org.name || "";
  byId("org-contact").value = s.org.contact || "";
  byId("org-email").value = s.org.email || "";
  byId("org-info").value = JSON.stringify(s.org.info || {}, null, 2);

  byId("mode").value = s.mode;
  byId("sched-pub").value = s.schedule.publishIntervalMin;
  byId("sched-meta").value = s.schedule.metadataIntervalHr;
  byId("sched-stale").value = s.schedule.staleThresholdMin;
}

function readSetup() {
  const s = state.settings;
  s.broker.host = byId("broker-host").value.trim();
  s.broker.port = parseInt(byId("broker-port").value, 10) || 5083;
  s.broker.tls = byId("broker-tls").checked;
  s.broker.insecure = byId("broker-insecure").checked;
  s.broker.username = byId("broker-username").value;
  s.broker.password = byId("broker-password").value;
  s.broker.caPem = byId("broker-capem").value.trim() || null;

  s.identity.assetGroupId = byId("id-ag").value.trim();
  s.identity.edgeDeviceId = byId("id-edge").value.trim();
  s.identity.accId = byId("id-acc").value.trim();
  s.identity.subId = byId("id-sub").value.trim();

  s.org.id = byId("org-id").value.trim();
  s.org.name = byId("org-name").value.trim();
  s.org.contact = byId("org-contact").value.trim();
  s.org.email = byId("org-email").value.trim();
  try { s.org.info = JSON.parse(byId("org-info").value || "{}"); } catch (_) { s.org.info = {}; }

  s.mode = byId("mode").value;
  s.schedule.publishIntervalMin = parseInt(byId("sched-pub").value, 10) || 15;
  s.schedule.metadataIntervalHr = parseInt(byId("sched-meta").value, 10) || 24;
  s.schedule.staleThresholdMin = parseInt(byId("sched-stale").value, 10) || 30;
}

function renderSites() {
  const tbody = byId("sitesTable");
  tbody.innerHTML = state.sites.map((site) => {
    const cfg = state.settings.sites[site.id] || {};
    const actual = cfg.enabled === true ? "checked" : "";
    return `<tr>
      <td><input type="checkbox" data-site="${escapeHtml(site.id)}" ${actual} /></td>
      <td class="font-mono text-xs">${escapeHtml(site.id)}</td>
      <td>${escapeHtml(site.name || "")}</td>
      <td class="text-gray-500">${escapeHtml(site.timezone || "")}</td>
      <td class="text-gray-500">${site.latitude?.toFixed(3) || "?"}, ${site.longitude?.toFixed(3) || "?"}</td>
    </tr>`;
  }).join("");

  tbody.querySelectorAll('input[type=checkbox][data-site]').forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.dataset.site;
      const site = state.sites.find((s) => s.id === id);
      if (!state.settings.sites[id]) state.settings.sites[id] = { enabled: false, overrides: {} };
      state.settings.sites[id].enabled = e.target.checked;
      if (e.target.checked && site && !state.settings.sites[id].overrides.timeZone) {
        state.settings.sites[id].overrides = {
          timeZone: site.timezone || "UTC",
          latitude: site.latitude,
          longitude: site.longitude,
          siteName: site.name,
          address: site.address,
        };
      }
    });
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
        : '<span class="text-xs text-gray-400">default</span>'}</td>
    `;
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
    b.addEventListener("click", (e) => {
      const k = e.target.dataset.removeMap;
      delete state.userMapping.nfTypeToCarrier[k];
      renderMapping();
    });
  });

  const defB = state.defaultMapping.bacnetVendorToCarrier || {};
  const userB = state.userMapping.bacnetVendorToCarrier || {};
  const keysB = new Set([...Object.keys(defB), ...Object.keys(userB)]);
  const tbodyB = byId("bacnetMappingTable");
  tbodyB.innerHTML = "";
  for (const k of [...keysB].sort()) {
    const isOverride = k in userB;
    const val = userB[k] ?? defB[k];
    const tr = document.createElement("tr");
    if (!isOverride) tr.classList.add("default-row");
    tr.innerHTML = `
      <td class="font-mono text-xs">${escapeHtml(k)}</td>
      <td><input value="${escapeHtml(val || "")}" data-bmap-key="${escapeHtml(k)}" /></td>
      <td>${isOverride
        ? `<button class="link" data-remove-bmap="${escapeHtml(k)}">Reset</button>`
        : '<span class="text-xs text-gray-400">default</span>'}</td>
    `;
    tbodyB.appendChild(tr);
  }
  tbodyB.querySelectorAll("input[data-bmap-key]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const k = e.target.dataset.bmapKey;
      const v = e.target.value.trim();
      if (!v) delete state.userMapping.bacnetVendorToCarrier[k];
      else state.userMapping.bacnetVendorToCarrier[k] = v;
    });
  });
  tbodyB.querySelectorAll("button[data-remove-bmap]").forEach((b) => {
    b.addEventListener("click", (e) => {
      const k = e.target.dataset.removeBmap;
      delete state.userMapping.bacnetVendorToCarrier[k];
      renderMapping();
    });
  });
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
  if (name === "preview") refreshPreview();
  if (name === "logs") refreshLogs();
}

async function saveAll() {
  if (!state.settingsLoaded) {
    U.showToast("error", "Cannot save — settings file could not be loaded. Reload the page.");
    return;
  }
  readSetup();
  // Hard guard: refuse to write if required identity fields are empty.
  // Prevents a wipe regression if the form was never populated.
  const s = state.settings;
  const missing = [];
  if (!s.broker.host) missing.push("Broker host");
  if (!s.identity.assetGroupId) missing.push("Asset Group ID");
  if (!s.identity.edgeDeviceId) missing.push("Edge Device ID");
  if (missing.length) {
    U.showToast("error", `Cannot save — missing required field(s): ${missing.join(", ")}`);
    console.warn("[abound] save aborted, empty fields:", missing);
    return;
  }
  try {
    await U.writeFile("/config/settings.json", JSON.stringify(state.settings, null, 2));
    console.log("[abound] saved settings.json");
  } catch (e) { U.showToast("error", `Save settings failed: ${e.message}`); return; }
  if (state.mappingLoaded) {
    try {
      await U.writeFile("/config/mapping.json", JSON.stringify(state.userMapping, null, 2));
    } catch (e) { U.showToast("error", `Save mapping failed: ${e.message}`); return; }
  }
  U.showToast("success", "Settings saved. Hooks pick them up on next run.");
  if (state.activeTab === "status") renderStatus();
}

async function runHook(name, args) {
  const h = hookByName(name);
  if (!h) { U.showToast("error", `Hook ${name} not found`); return null; }
  try {
    console.log(`[abound] starting ${name}`, args || {});
    U.showToast("info", `Starting ${name}…`, 2000);
    await U.startHook(h.id, args);
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const r = await U.getHookRuns(h.id, 1);
      const run = (r.runs || [])[0];
      if (run && (run.state === 6 || run.state === 9)) {
        console.log(`[abound] ${name} run:`, run);
        if (run.state === 6) {
          U.showToast("success", `${name} completed`);
          await logLatestPayloadFromFile(name);
        } else {
          U.showToast("error", `${name} failed — see Logs`);
        }
        return run;
      }
    }
    U.showToast("info", `${name} still running — check Logs`);
    return null;
  } catch (e) {
    U.showToast("error", `${name}: ${e.message}`);
    return null;
  }
}

async function logLatestPayloadFromFile(hookName) {
  const isData = /data/i.test(hookName) && !/meta/i.test(hookName);
  const file = isData ? "/config/.last-data-payload.json" : "/config/.last-metadata-payload.json";
  try {
    const raw = await U.readFile(file);
    if (!raw) { console.warn(`[abound] no ${file}`); return; }
    const rec = JSON.parse(raw);
    console.group(`[abound.payload.${isData ? "data" : "meta"}] topic=${rec.topic} ts=${rec.ts}`);
    console.log(rec.payload);
    console.groupEnd();

    const topicEl = byId(isData ? "previewDataTopic" : "previewMetaTopic");
    const preEl   = byId(isData ? "previewData"      : "previewMeta");
    if (topicEl && preEl) {
      topicEl.classList.remove("empty");
      topicEl.textContent = `${rec.topic}  (${rec.ts})`;
      preEl.classList.remove("empty");
      preEl.textContent = JSON.stringify(rec.payload, null, 2);
    }
  } catch (e) {
    console.warn(`[abound] failed to read ${file}:`, e);
  }
}

async function refreshPreview() {
  const dataTopic = byId("previewDataTopic");
  const dataPre = byId("previewData");
  const metaTopic = byId("previewMetaTopic");
  const metaPre = byId("previewMeta");
  [dataTopic, metaTopic].forEach((el) => { el.classList.add("empty"); el.textContent = "(no recent publish)"; });
  dataPre.classList.add("empty");
  metaPre.classList.add("empty");
  dataPre.textContent = "Click 'Publish data now' to emit a payload.";
  metaPre.textContent = "Click 'Publish metadata now' to emit a payload.";

  await Promise.all([
    logLatestPayloadFromFile("publish-data"),
    logLatestPayloadFromFile("publish-metadata"),
  ]);
}

async function refreshLogs() {
  const box = byId("logsContent");
  box.innerHTML = `
    <div class="text-xs text-gray-600">
      Hook-run state is shown below. Full payload previews live in the Preview tab.
    </div>
  `;
  const names = ["publish-data", "publish-metadata", "test-publish", "publish-now", "publish-metadata-now"];
  for (const n of names) {
    const h = hookByName(n);
    if (!h) continue;
    const r = await U.getHookRuns(h.id, 5).catch(() => ({ runs: [] }));
    const rows = (r.runs || []).slice(0, 5).map((run) => `
      <div class="text-xs">
        ${stateBadge(run.state)} pid=${run.pid}
        <span class="text-gray-500">${fmtTime(run.startTime || run.startedAt)}</span>
        ${run.message ? ` · ${escapeHtml(run.message)}` : ""}
      </div>
    `).join("");
    box.innerHTML += `<div class="mt-3"><div class="font-semibold text-primary-dark-purple">${n}</div>${rows || '<div class="text-xs text-gray-400">no runs</div>'}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function wire() {
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => setTab(t.dataset.tab))
  );

  byId("btnSave").addEventListener("click", saveAll);
  byId("btnTest").addEventListener("click", () => runHook("test-publish"));
  byId("btnPublishNow").addEventListener("click", () => runHook("publish-now"));
  byId("btnPublishMetaNow").addEventListener("click", () => runHook("publish-metadata-now"));

  byId("sitesAll").addEventListener("click", () => {
    for (const s of state.sites) {
      state.settings.sites[s.id] = {
        enabled: true,
        overrides: { timeZone: s.timezone, latitude: s.latitude, longitude: s.longitude, siteName: s.name, address: s.address },
      };
    }
    renderSites();
  });
  byId("sitesNone").addEventListener("click", () => {
    for (const id of Object.keys(state.settings.sites)) state.settings.sites[id].enabled = false;
    renderSites();
  });

  byId("btnAddMap").addEventListener("click", () => {
    const k = byId("newMapKey").value.trim();
    const v = byId("newMapVal").value.trim();
    if (!k || !v) return;
    state.userMapping.nfTypeToCarrier[k] = v;
    byId("newMapKey").value = ""; byId("newMapVal").value = "";
    renderMapping();
  });
  byId("btnAddBac").addEventListener("click", () => {
    const k = byId("newBacKey").value.trim();
    const v = byId("newBacVal").value.trim();
    if (!k || !v) return;
    state.userMapping.bacnetVendorToCarrier[k] = v;
    byId("newBacKey").value = ""; byId("newBacVal").value = "";
    renderMapping();
  });

  byId("btnRefreshPreview").addEventListener("click", refreshPreview);
  byId("btnRefreshLogs").addEventListener("click", refreshLogs);
}

(async function main() {
  wire();
  try {
    await load();
    setTab("status");
    if (!state.settingsLoaded) {
      U.showToast("error", "Settings failed to load — Save is disabled. Reload the page.", 8000);
    }
  } catch (e) {
    U.showToast("error", `Initial load failed: ${e.message}`);
    console.error(e);
  }
})();

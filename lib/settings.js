// Load/save plugin settings from /config/settings.json (inside the app dir).
// All configuration (broker, identity, org, mode, sites, schedule) lives here.

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "..", "config", "settings.json");

const DEFAULTS = {
  version: 1,
  broker: {
    host: "",
    port: 5083,
    tls: true,
    username: "",
    password: "",
    caPem: null,
    insecure: false,
  },
  identity: {
    assetGroupId: "",
    edgeDeviceId: "",
    accId: "",
    subId: "",
  },
  org: {
    id: "",
    name: "",
    contact: "",
    email: "",
    info: {},
  },
  mode: "modeled", // "modeled" | "raw"
  schedule: {
    publishIntervalMin: 15,
    metadataIntervalHr: 24,
    staleThresholdMin: 30,
  },
  // site-id -> { enabled: bool, overrides: {...} }
  sites: {},
};

function deepMerge(a, b) {
  if (b === null || b === undefined) return a;
  if (typeof a !== "object" || typeof b !== "object" || Array.isArray(a) || Array.isArray(b)) {
    return b;
  }
  const out = { ...a };
  for (const k of Object.keys(b)) {
    out[k] = k in a ? deepMerge(a[k], b[k]) : b[k];
  }
  return out;
}

function load() {
  try {
    const raw = fs.readFileSync(SETTINGS_PATH, "utf8");
    const user = JSON.parse(raw);
    return deepMerge(DEFAULTS, user);
  } catch (e) {
    if (e.code === "ENOENT") return { ...DEFAULTS };
    throw new Error(`Failed to load settings from ${SETTINGS_PATH}: ${e.message}`);
  }
}

function save(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function isConfigured(s) {
  return !!(
    s.broker && s.broker.host &&
    s.identity && s.identity.assetGroupId && s.identity.edgeDeviceId
  );
}

module.exports = { load, save, isConfigured, DEFAULTS, SETTINGS_PATH };

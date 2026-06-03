// Load/save plugin settings from /config/settings.json (inside the app dir).
// All configuration (DMS connection, schedule, sites) lives here.

const fs = require("fs");
const path = require("path");

const SETTINGS_PATH = path.join(__dirname, "..", "config", "settings.json");

const DEFAULTS = {
  version: 2,
  // Carrier Abound Data Ingestion Service (DMS) connection.
  dms: {
    baseUrl: "",        // e.g. https://ingest.ws.insights.cortix.ai  (path /v1/dms/data is appended)
    tokenUrl: "",       // OAuth2 token endpoint
    clientId: "",
    clientSecret: "",
    scope: "",
    systemId: "",       // unique source-system id, sent in every POST body
    verifyTls: true,    // set false to skip TLS verification (test only)
  },
  schedule: {
    staleThresholdMin: 30, // drives the per-equipment _comm freshness flag
  },
  // site-id -> { enabled: bool }
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
    if (e.code === "ENOENT") return JSON.parse(JSON.stringify(DEFAULTS));
    throw new Error(`Failed to load settings from ${SETTINGS_PATH}: ${e.message}`);
  }
}

function save(settings) {
  const dir = path.dirname(SETTINGS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
}

function isConfigured(s) {
  const d = s.dms || {};
  return !!(d.baseUrl && d.tokenUrl && d.clientId && d.clientSecret && d.systemId);
}

module.exports = { load, save, isConfigured, DEFAULTS, SETTINGS_PATH };

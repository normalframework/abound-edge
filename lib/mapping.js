// Type mapping: NF equipment class / BACnet vendor-model → Carrier Abound asset type.
// Ship defaults in /config/default-mapping.json. User overrides live in /config/mapping.json.

const fs = require("fs");
const path = require("path");

const DEFAULT_PATH = path.join(__dirname, "..", "config", "default-mapping.json");
const USER_PATH = path.join(__dirname, "..", "config", "mapping.json");

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function load() {
  const def = readJson(DEFAULT_PATH) || { nfTypeToCarrier: {}, bacnetVendorToCarrier: {} };
  const user = readJson(USER_PATH) || {};
  return {
    nfTypeToCarrier: { ...def.nfTypeToCarrier, ...(user.nfTypeToCarrier || {}) },
    bacnetVendorToCarrier: { ...def.bacnetVendorToCarrier, ...(user.bacnetVendorToCarrier || {}) },
  };
}

function saveUser(user) {
  const dir = path.dirname(USER_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(USER_PATH, JSON.stringify(user, null, 2));
}

function resolveEquipmentType(map, nfType) {
  if (!nfType) return "Unknown";
  return map.nfTypeToCarrier[nfType] || "Unknown";
}

function resolveBacnetType(map, vendorModel) {
  if (!vendorModel) return "Unknown";
  return map.bacnetVendorToCarrier[vendorModel] || "Unknown";
}

module.exports = { load, saveUser, resolveEquipmentType, resolveBacnetType, DEFAULT_PATH, USER_PATH };

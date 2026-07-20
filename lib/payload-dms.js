// Build Carrier Abound DMS device-model payloads — one POST body per site.
//
// Body (per site):  { systemId, data: [ <equip obj>, ... ] }
// Equip obj:        { <pointKey>: "<stringValue>", ..., _ts, _id, _path, _comm, _model }
//   _ts    ms-epoch, RE-STAMPED each run to the current 15-min publish grid
//          (:00/:15/:30/:45 UTC). Abound can't handle change-of-value, so we
//          resend every point every cycle with a fresh, advancing timestamp —
//          even when the source value is unchanged — so each POST ingests as a
//          new sample instead of being deduped.
//   _id    "<siteId>/<equipSlug>"
//   _path  "<siteName>/<equipRef>"
//   _comm  "0.0" communicating (>=1 point updated within the stale window) |
//          "1.0" not (no point updated within the window). INVERTED vs old MQTT.
//   _model mapped Carrier asset type (omitted when Unknown)
//
// Enum value-remapping + relabeling is handled by NF Conversions (applied on the
// read path), so the latestValue we read here is already the converted value —
// no enum logic in this module.

const ids = require("./ids");

const RESERVED = new Set(["_ts", "_id", "_path", "_comm", "_model", "_sn"]);
const GRID_MS = 15 * 60 * 1000; // publish cadence / timestamp grid

function tsMs(ts) {
  if (ts === null || ts === undefined) return 0;
  const t = typeof ts === "string" ? Date.parse(ts) : ts;
  return Number.isNaN(t) ? 0 : t;
}

function isFresh(ts, staleMs) {
  const t = tsMs(ts);
  return t > 0 && Date.now() - t <= staleMs;
}

// Current publish time floored to the 15-min grid (shared by all equipment in a run).
function gridStamp(nowMs = Date.now()) {
  return Math.floor(nowMs / GRID_MS) * GRID_MS;
}

function stringifyValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    if ("real" in v) return String(v.real);
    if ("double" in v) return String(v.double);
    if ("signed" in v) return String(v.signed);
    if ("unsigned" in v) return String(v.unsigned);
    if ("boolean" in v) return v.boolean ? "1" : "0";
    if ("characterString" in v) return v.characterString;
    if ("value" in v) return String(v.value);
    return "";
  }
  return String(v);
}

// devices: enriched output of mode-modeled.collect()
// sitesMeta: { siteRef: siteName }
// Returns { [siteRef]: { siteName, systemId, data: [...] } }
function build(settings, devices, sitesMeta = {}) {
  const staleMs = (settings.schedule.staleThresholdMin || 30) * 60 * 1000;
  const systemId = settings.dms.systemId;
  // One re-stamp value for the whole run, aligned to the 15-min grid.
  const stampTs = String(gridStamp());
  const bySite = {};

  for (const dev of devices) {
    const site = dev.siteRef || "";
    if (!site || !dev.points.length) continue;
    const siteName = sitesMeta[site] || site;
    if (!bySite[site]) bySite[site] = { siteName, systemId, data: [] };

    const obj = {};
    let anyFresh = false; // did any source point update within the stale window?
    for (const p of dev.points) {
      if (RESERVED.has(p.key)) continue; // never let a point shadow a reserved key
      const lv = p.latestValue || {};
      if (isFresh(lv.ts, staleMs)) anyFresh = true;
      obj[p.key] = stringifyValue(lv);
    }

    obj._ts = stampTs;                      // re-stamped to the 15-min grid (resend-every-cycle)
    obj._id = ids.equipId(site, dev.equipRef);
    obj._path = ids.equipPath(siteName, dev.equipRef);
    obj._comm = anyFresh ? "0.0" : "1.0";   // 1.0 when no point updated within the window
    if (dev.carrierType && dev.carrierType !== "Unknown") obj._model = dev.carrierType;

    bySite[site].data.push(obj);
  }

  return bySite;
}

module.exports = { build, stringifyValue, isFresh, tsMs, gridStamp, GRID_MS };

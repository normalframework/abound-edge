// Scheduled, siteRef-grouped, streaming DMS publisher. The framework streams the
// site's points (with latest values, already enum-converted on read) into each
// per-site invocation — no point/equipment API queries here.
//
// The stream contains BOTH data points (equipRef + point class + latestValue) and
// equipment-instance records (markers "...,equip", class = equip class, id =
// equipRef). We use the equip records only to resolve _model.

const fs = require("fs");
const path = require("path");

const settingsLib = require("./lib/settings");
const mappingLib  = require("./lib/mapping");
const dms         = require("./lib/dms-client");
const payloadDms  = require("./lib/payload-dms");

const CONFIG_DIR = path.join(__dirname, "config");

// An equipment-instance record (not a data point) — carries the equipment class.
function isEquipRecord(a) {
  if (/(^|,)equip(,|$)/.test(a.markers || "")) return true;
  return !!(a.id && a.equipTypeId && !a.object_id && !a.prop_present_value);
}

function safeName(s) { return String(s).replace(/[^a-z0-9._-]/gi, "_"); }

// Distinct, non-empty values of an attribute across a group's points. We only
// send ONE area_served / equip_serves per equipment in the _path, so a group
// whose points disagree is a data problem the caller warns about.
function distinctAttrValues(pts, key) {
  const seen = new Set();
  for (const p of pts) {
    const v = ((p.attrs && p.attrs[key]) || "").trim();
    if (v) seen.add(v);
  }
  return [...seen];
}

  // The key sent to Abound. Prefer the mapped Carrier API point name
  // (api_point_path attr, set by the rtu mapping workflow); fall back to the
  // last segment of the point name for any point that has no mapping.
  function pointKey(p) {
    const mapped = p.attrs && p.attrs.api_point_path;
    return mapped || p.name.split("/").pop();
  } 

// POST one site's data array, halving on 413 until it fits.
async function postSite(sdk, s, systemId, dataArr) {
  if (!dataArr.length) return { posted: 0, errors: [] };
  try {
    const resp = await dms.postData(sdk, s, { systemId, data: dataArr });
    return { posted: dataArr.length, errors: (resp.data && resp.data.errors) || [] };
  } catch (e) {
    if (e.status === 413 && dataArr.length > 1) {
      const mid = Math.ceil(dataArr.length / 2);
      const a = await postSite(sdk, s, systemId, dataArr.slice(0, mid));
      const b = await postSite(sdk, s, systemId, dataArr.slice(mid));
      return { posted: a.posted + b.posted, errors: a.errors.concat(b.errors) };
    }
    throw e;
  }
}

module.exports = async ({ points, sdk }) => {
  const siteRef = sdk.groupKey;
  if (!siteRef) return { ok: true, skipped: "no siteRef (loose points)" };

  const s = settingsLib.load();
  if (!settingsLib.isConfigured(s)) {
    sdk.logEvent("abound: not configured — open the dashboard to set the DMS connection");
    return { ok: false, error: "not configured" };
  }
  const siteCfg = s.sites[siteRef];
  if (siteCfg && siteCfg.enabled === false) return { ok: true, skipped: "disabled" };

  const map = mappingLib.load();

  // Split the stream into equip-class map + data points grouped by equipRef.
  const equipClassByRef = {};
  const dataByEquip = {};
  points.forEach((p) => {
    const a = p.attrs || {};
    if (isEquipRecord(a)) {
      const ref = a.id || p.name;
      if (a.class) equipClassByRef[ref] = a.class;
      return;
    }
    const ref = a.equipRef;
    if (!ref || !p.name) return; // only publish classified data points
    (dataByEquip[ref] || (dataByEquip[ref] = [])).push(p);
  });

  const siteName = (siteCfg && siteCfg.name) || siteRef;
  const devices = Object.entries(dataByEquip).map(([equipRef, pts]) => {
    // Resolve the single area_served / equip_serves used in the _path hierarchy.
    // 1 distinct value → use it; 0 → attr absent, path falls back to Site/RTUID;
    // >1 → the group's points disagree, so warn and fall back to Site/RTUID
    // rather than pick an arbitrary one.
    const areaVals  = distinctAttrValues(pts, "area_served");
    const equipVals = distinctAttrValues(pts, "equip_serves");
    if (areaVals.length > 1) {
      sdk.logEvent(`abound: WARN ${siteRef}/${equipRef} has ${areaVals.length} distinct area_served values, using Site/RTUID path: ${areaVals.join(" | ")}`);
    }
    if (equipVals.length > 1) {
      sdk.logEvent(`abound: WARN ${siteRef}/${equipRef} has ${equipVals.length} distinct equip_serves values, using Site/RTUID path: ${equipVals.join(" | ")}`);
    }
    return {
      siteRef,
      equipRef,
      carrierType: mappingLib.resolveEquipmentType(map, equipClassByRef[equipRef] || ""),
      areaServed:  areaVals.length === 1 ? areaVals[0] : "",
      equipServes: equipVals.length === 1 ? equipVals[0] : "",
      points: pts.map((p) => ({ key: pointKey(p), latestValue: p.latestValue || {} })),
    };
  });

  if (!devices.length) {
    sdk.logEvent(`abound: ${siteRef} — no publishable equipment`);
    return { ok: true, site: siteRef, equipment: 0 };
  }

  const bySite = payloadDms.build(s, devices, { [siteRef]: siteName });
  const body = bySite[siteRef] || { systemId: s.dms.systemId, data: [] };

  // Persist a per-site preview the dashboard can read.
  try {
    const f = path.join(CONFIG_DIR, `.last-data-${safeName(siteRef)}.json`);
    fs.writeFileSync(f, JSON.stringify({ ts: new Date().toISOString(), url: dms.dataUrl(s), siteRef, body }, null, 2));
  } catch (e) {
    sdk.logEvent(`abound: WARN could not persist preview for ${siteRef}: ${e.message}`);
  }

  // A token-fetch failure or a failed DMS POST throws out of postSite. Log it,
  // then re-throw so the hook run is recorded as FAILED (state 9) rather than
  // success — otherwise a silently-swallowed error looks like a healthy run.
  try {
    const r = await postSite(sdk, s, body.systemId, body.data);
    sdk.logEvent(`abound: posted ${siteRef} — ${r.posted} equipment${r.errors.length ? `, ${r.errors.length} per-equipment errors` : ""}`);
    return { ok: true, site: siteRef, equipment: r.posted, errors: r.errors.length };
  } catch (e) {
    const detail = e.body ? ` ${JSON.stringify(e.body).slice(0, 300)}` : "";
    sdk.logEvent(`abound: ERROR posting ${siteRef}: ${e.status || ""} ${e.message}${detail}`);
    throw new Error(`abound: ${siteRef} publish failed: ${e.status || ""} ${e.message}${detail}`.replace(/\s+/g, " ").trim());
  }
};

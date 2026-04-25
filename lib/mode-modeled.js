// Modeled mode: _assetList = NF equipment instances per site; devices[] per equipment.
// Device _id = equipment's haystack `id` attr (preferring short-form user-defined records).
// info = all other equipment attrs (minus housekeeping keys).

const nf = require("./nf");
const mapping = require("./mapping");

const HIDE_ATTRS = new Set(["markers", "class", "equipTypeId", "id"]);

function siteFilterQuery(enabledIds) {
  if (!enabledIds.length) return null;
  if (enabledIds.length === 1) return { field: { property: "siteRef", text: enabledIds[0] } };
  return { or: enabledIds.map((id) => ({ field: { property: "siteRef", text: id } })) };
}
function orQuery(prop, values) {
  if (!values.length) return null;
  if (values.length === 1) return { field: { property: prop, text: values[0] } };
  return { or: values.map((v) => ({ field: { property: prop, text: v } })) };
}

function filteredAttrs(a) {
  const out = {};
  for (const [k, v] of Object.entries(a || {})) {
    if (HIDE_ATTRS.has(k)) continue;
    out[k] = v;
  }
  return out;
}

async function collect(sdk, settings, mapData) {
  const enabledCfg = settings.sites || {};
  const enabledIds = Object.keys(enabledCfg).filter((id) => enabledCfg[id].enabled !== false);
  const enabledSet = new Set(enabledIds);

  // 1. Points (default layer), filtered by enabled sites.
  const siteQ = siteFilterQuery(enabledIds);
  const pointRows = siteQ
    ? await nf.queryPoints(sdk, siteQ, { layer: "default" })
    : await nf.queryPoints(sdk, { field: { property: "equipRef", text: "", wildcard: false } }, { layer: "default" });

  const pointsByEquipRef = {};
  for (const p of pointRows) {
    const a = p.attrs || {};
    const eqRef = a.equipRef || "";
    if (!eqRef) continue;
    if (!pointsByEquipRef[eqRef]) pointsByEquipRef[eqRef] = [];
    pointsByEquipRef[eqRef].push(p);
  }
  const equipRefs = Object.keys(pointsByEquipRef);

  // 2. Long-name equipment records (model layer, name matches equipRef).
  const equipByName = {};
  if (equipRefs.length) {
    const CHUNK = 100;
    for (let i = 0; i < equipRefs.length; i += CHUNK) {
      const batch = equipRefs.slice(i, i + CHUNK);
      const rows = await nf.queryPoints(sdk, orQuery("name", batch), { layer: "model" });
      for (const r of rows) {
        const a = r.attrs || {};
        if (!a.class || a.equipRef) continue;
        equipByName[r.name] = { id: a.id || r.name, className: a.class, attrs: a, name: r.name };
      }
    }
  }

  // 3. Short-form equipment records (model layer) keyed by user-defined equipTypeId.
  //    These give us short ids like "VMA-7"; we substring-match long equipRefs
  //    against short names to find the canonical user-selected identity.
  let shortEquips = [];
  try {
    const types = await nf.listEquipmentTypes(sdk);
    const typeIds = types.map((t) => t.id).filter(Boolean);
    if (typeIds.length) {
      const rows = await nf.queryPoints(sdk, orQuery("equipTypeId", typeIds), { layer: "model" });
      shortEquips = rows.filter((r) => r.attrs && r.attrs.class && !r.attrs.equipRef);
    }
    sdk.logEvent(`abound: resolved ${types.length} equipment types; ${shortEquips.length} short-form equipment records`);
  } catch (e) {
    sdk.logEvent(`abound: WARN shortEquips lookup failed: ${e.message}`);
  }

  function preferredEquip(longRef) {
    // Prefer a substring-matched short record (so "VMA-7" overrides the long equipRef).
    let best = null;
    for (const r of shortEquips) {
      const sn = r.name || "";
      if (!sn || sn === longRef) continue;
      if (longRef.includes(sn)) {
        if (!best || sn.length > best.name.length) {
          best = {
            id: (r.attrs && r.attrs.id) || r.name,
            className: (r.attrs && r.attrs.class) || "",
            attrs: r.attrs || {},
            name: r.name,
          };
        }
      }
    }
    if (best) return { preferred: best, matched: "short" };
    if (equipByName[longRef]) return { preferred: equipByName[longRef], matched: "long" };
    return { preferred: null, matched: "none" };
  }

  const locationsAssets = {};
  const devices = [];
  let shortMatches = 0, longMatches = 0, noneMatches = 0;

  for (const [eqRef, pts] of Object.entries(pointsByEquipRef)) {
    const siteRef = (pts[0] && pts[0].attrs && pts[0].attrs.siteRef) || "";
    if (enabledSet.size && siteRef && !enabledSet.has(siteRef)) continue;

    const { preferred, matched } = preferredEquip(eqRef);
    if (matched === "short") shortMatches++;
    else if (matched === "long") longMatches++;
    else noneMatches++;

    const long = equipByName[eqRef];
    const equipId = preferred ? preferred.id : eqRef;
    const className = preferred ? preferred.className : "";
    const carrierType = mapping.resolveEquipmentType(mapData, className);

    const info = {
      ...(long ? filteredAttrs(long.attrs) : {}),
      ...(preferred ? filteredAttrs(preferred.attrs) : {}),
      className,
      siteRef,
      pointCount: pts.length,
      equipRef: eqRef,
      ...(long && long.name && long.name !== equipId ? { longName: long.name } : {}),
    };

    if (siteRef) {
      if (!locationsAssets[siteRef]) locationsAssets[siteRef] = [];
      locationsAssets[siteRef].push({ id: equipId, type: carrierType, info });
    }

    devices.push({
      id: equipId,
      points: pts
        .filter((p) => p.attrs && p.attrs.class)
        .map((p) => ({ name: p.attrs.class, latestValue: p.latestValue || {} })),
    });
  }

  sdk.logEvent(`abound: equipRef match breakdown — short=${shortMatches} long=${longMatches} none=${noneMatches}`);
  return { locationsAssets, devices };
}

module.exports = { collect };

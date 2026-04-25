// Raw mode: _assetList = BACnet devices per site, devices[] per BACnet device.
// data keys = point names (object names) — no class remap.

const nf = require("./nf");
const mapping = require("./mapping");

function siteFilterQuery(enabledIds) {
  if (!enabledIds.length) return null;
  if (enabledIds.length === 1) {
    return { field: { property: "siteRef", text: enabledIds[0] } };
  }
  return { or: enabledIds.map((id) => ({ field: { property: "siteRef", text: id } })) };
}

async function collect(sdk, settings, mapData) {
  const enabledCfg = settings.sites || {};
  const enabledIds = Object.keys(enabledCfg).filter((id) => enabledCfg[id].enabled !== false);

  const siteQ = siteFilterQuery(enabledIds);
  const query = siteQ
    ? { and: [siteQ, { field: { property: "device_id", text: "*", wildcard: true } }] }
    : { field: { property: "device_id", text: "*", wildcard: true } };

  const points = await nf.queryPoints(sdk, query);

  // Group points by device_id
  const byDev = {};
  for (const p of points) {
    const a = p.attrs || {};
    const devId = a.device_id || "";
    if (!devId) continue;
    if (!byDev[devId]) {
      byDev[devId] = {
        siteRef: a.siteRef || "",
        deviceName: a.device_name || devId,
        vendor: a.vendor || "",
        model: a.model || "",
        points: [],
      };
    }
    byDev[devId].points.push(p);
    if (!byDev[devId].siteRef && a.siteRef) byDev[devId].siteRef = a.siteRef;
  }

  const locationsAssets = {};
  const devices = [];
  for (const [devId, g] of Object.entries(byDev)) {
    const vm = [g.vendor, g.model].filter(Boolean).join(" ").trim();
    const carrierType = mapping.resolveBacnetType(mapData, vm);
    if (g.siteRef) {
      if (!locationsAssets[g.siteRef]) locationsAssets[g.siteRef] = [];
      locationsAssets[g.siteRef].push({
        id: devId,
        type: carrierType,
        info: {
          deviceName: g.deviceName,
          vendor: g.vendor,
          model: g.model,
          pointCount: g.points.length,
        },
      });
    }
    devices.push({
      id: devId,
      points: g.points.map((p) => ({
        name: p.name || p.uuid,
        latestValue: p.latestValue || {},
      })),
    });
  }

  return { locationsAssets, devices };
}

module.exports = { collect };

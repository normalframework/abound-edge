// Map NF sites → Carrier location records using per-site overrides from settings.

const nf = require("./nf");

// Returns array of carrier-shape locations, filtered to enabled sites in settings.
async function buildLocations(sdk, settings, assetListsBySiteId) {
  const all = await nf.listSites(sdk);
  const enabledCfg = settings.sites || {};
  const locations = [];

  for (const site of all) {
    const cfg = enabledCfg[site.id];
    if (!cfg || cfg.enabled === false) continue;
    const ov = cfg.overrides || {};
    locations.push({
      id: site.id,
      siteName: ov.siteName || site.name || site.id,
      address: ov.address || site.address || "",
      latitude: ov.latitude !== undefined ? ov.latitude : site.latitude,
      longitude: ov.longitude !== undefined ? ov.longitude : site.longitude,
      tempUOM: ov.tempUOM || "F",
      timeZone: ov.timeZone || site.timezone || "UTC",
      info: ov.info || {},
      assetList: assetListsBySiteId[site.id] || [],
    });
  }
  return locations;
}

// For counts / dashboard: return enabled site ids, and all sites with meta.
async function enabledSiteIds(sdk, settings) {
  const all = await nf.listSites(sdk);
  const enabledCfg = settings.sites || {};
  return all.filter((s) => enabledCfg[s.id] && enabledCfg[s.id].enabled !== false).map((s) => s.id);
}

module.exports = { buildLocations, enabledSiteIds };

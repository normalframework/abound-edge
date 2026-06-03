// Re-register the publish-data hook's point binding so the framework only streams
// the ENABLED sites, grouped by siteRef. Called by the dashboard after settings
// are saved. Uses UpdateHook (POST /hooks); upserts by name. Also clears the
// cached OAuth token so a credential change (clientId/secret/scope/url) takes
// effect immediately instead of waiting for the old token to expire.

const settingsLib = require("./lib/settings");
const dms = require("./lib/dms-client");

const RRULE = "DTSTART:20260101T000000Z\nRRULE:FREQ=MINUTELY;INTERVAL=15";

function siteQuery(ids) {
  if (!ids.length) return { field: { property: "siteRef", text: "__no_enabled_sites__" } };
  if (ids.length === 1) return { field: { property: "siteRef", text: ids[0] } };
  return { or: ids.map((id) => ({ field: { property: "siteRef", text: id } })) };
}

module.exports = async ({ sdk }) => {
  const s = settingsLib.load();
  const enabled = Object.keys(s.sites || {}).filter((id) => s.sites[id].enabled === true);

  const def = {
    name: "publish-data",
    entryPoint: "/publish-data.js",
    points: { query: siteQuery(enabled), groups: { keys: ["siteRef"] } },
    schedule: { rrule: RRULE },
    mode: "MODE_SCHEDULED",
  };

  await sdk.http.post("/api/v1/apps/abound/hooks", def);
  dms.clearTokenCache(); // settings may have changed the DMS credentials

  sdk.logEvent(`abound: reconfigured publish-data for ${enabled.length} site(s): ${enabled.join(", ") || "(none)"}; token cache cleared`);
  return { ok: true, sites: enabled.length, enabled };
};

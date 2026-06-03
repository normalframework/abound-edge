// Connection test: acquire an OAuth token, then probe GET /v1/dms/data.
// Token acquisition is the primary signal; the GET probe is best-effort
// (not every deployment serves the availability GET).

const settingsLib = require("./lib/settings");
const dms = require("./lib/dms-client");

module.exports = async ({ sdk }) => {
  const s = settingsLib.load();
  if (!settingsLib.isConfigured(s)) {
    sdk.logEvent("abound: not configured");
    return { ok: false, error: "not configured" };
  }
  try {
    await dms.getToken(sdk, s, true); // force a fresh token
    sdk.logEvent("abound: OAuth token acquired");
  } catch (e) {
    sdk.logEvent(`abound: token request failed: ${e.message}`);
    throw e;
  }
  try {
    const r = await dms.ping(sdk, s);
    sdk.logEvent(`abound: DMS availability probe → ${r.status}`);
    return { ok: true, token: true, ping: r.status };
  } catch (e) {
    sdk.logEvent(`abound: token OK; availability probe failed: ${e.status || e.message}`);
    return { ok: true, token: true, ping: e.status || "error" };
  }
};

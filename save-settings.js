const settingsLib = require("./lib/settings");

module.exports = async ({ sdk, args }) => {
  const raw = args && args.settings;
  if (!raw) {
    throw new Error("missing args.settings (JSON string)");
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
  settingsLib.save(parsed);
  sdk.logEvent("abound: settings saved");
};

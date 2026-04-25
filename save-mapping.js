const mappingLib = require("./lib/mapping");

module.exports = async ({ sdk, args }) => {
  const raw = args && args.mapping;
  if (!raw) throw new Error("missing args.mapping (JSON string)");
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
  mappingLib.saveUser(parsed);
  sdk.logEvent("abound: mapping saved");
};

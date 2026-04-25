const settingsLib = require("./lib/settings");
const broker      = require("./lib/broker");

module.exports = async ({ sdk }) => {
  const s = settingsLib.load();
  if (!settingsLib.isConfigured(s)) {
    sdk.logEvent("abound: not configured");
    return { ok: false, error: "not configured" };
  }
  const topic = `CORTIXedgeData/${s.identity.assetGroupId}/i/${s.identity.edgeDeviceId}/openmqtt.probe`;
  try {
    const c = await broker.connect(s);
    await broker.publish(c, topic, {
      probe: true,
      ts: Date.now(),
      controller: s.identity.edgeDeviceId,
    });
    sdk.logEvent(`abound: probe published → ${topic}`);
  } catch (e) {
    sdk.logEvent(`abound: probe failed: ${e.message}`);
    throw e;
  }
};

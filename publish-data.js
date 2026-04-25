// Scheduled data publisher. Builds the openmqtt livedata payload per enabled site
// and publishes to CORTIXedgeData/<ag>/i/<edge>/openmqtt.

const fs = require("fs");
const path = require("path");

const settingsLib = require("./lib/settings");
const mappingLib  = require("./lib/mapping");
const broker      = require("./lib/broker");
const topics      = require("./lib/topics");
const payloadData = require("./lib/payload-data");
const modeModeled = require("./lib/mode-modeled");
const modeRaw     = require("./lib/mode-raw");

const LAST_PAYLOAD_PATH = path.join(__dirname, "config", ".last-data-payload.json");

module.exports = async ({ sdk }) => {
  const s = settingsLib.load();
  if (!settingsLib.isConfigured(s)) {
    sdk.logEvent("abound: not configured — open the dashboard to set broker + identity");
    return;
  }
  const map = mappingLib.load();

  sdk.logEvent(`abound: data publish starting (mode=${s.mode})`);

  const { devices } =
    s.mode === "raw"
      ? await modeRaw.collect(sdk, s, map)
      : await modeModeled.collect(sdk, s, map);

  if (!devices.length) {
    sdk.logEvent("abound: no devices to publish");
    return;
  }

  const payload = payloadData.build(s, devices);
  const topic = topics.dataTopic(s);

  // Persist the last rendered payload so the dashboard can read it without
  // streaming hook events.
  try {
    const dir = path.dirname(LAST_PAYLOAD_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_PAYLOAD_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      topic,
      payload,
    }, null, 2));
  } catch (e) {
    sdk.logEvent(`abound: WARN could not persist last payload: ${e.message}`);
  }

  const c = await broker.connect(s);
  await broker.publish(c, topic, payload);
  const totalValues = payload.livedata.devices.reduce(
    (n, d) => n + Object.keys(d.data).length, 0);
  sdk.logEvent(`abound: published data → ${topic} (${devices.length} devices, ${totalValues} values)`);
};

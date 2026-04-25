// Scheduled metadata publisher. Hash-diffs to avoid no-op sends.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const settingsLib = require("./lib/settings");
const mappingLib  = require("./lib/mapping");
const broker      = require("./lib/broker");
const topics      = require("./lib/topics");
const payloadMeta = require("./lib/payload-metadata");
const sitesLib    = require("./lib/sites");
const modeModeled = require("./lib/mode-modeled");
const modeRaw     = require("./lib/mode-raw");

const HASH_PATH = path.join(__dirname, "config", ".metadata-hash");
const LAST_PAYLOAD_PATH = path.join(__dirname, "config", ".last-metadata-payload.json");

function sha256(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

module.exports = async ({ sdk, args }) => {
  const s = settingsLib.load();
  if (!settingsLib.isConfigured(s)) {
    sdk.logEvent("abound: not configured — open the dashboard to set broker + identity");
    return;
  }
  const map = mappingLib.load();
  const force = args && (args.force === "true" || args.force === true);

  const { locationsAssets } =
    s.mode === "raw"
      ? await modeRaw.collect(sdk, s, map)
      : await modeModeled.collect(sdk, s, map);

  const locations = await sitesLib.buildLocations(sdk, s, locationsAssets);
  const payload = payloadMeta.build(s, locations);

  // Always persist the rendered payload so the dashboard can preview it, even if we skip publishing.
  try {
    const dir = path.dirname(LAST_PAYLOAD_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_PAYLOAD_PATH, JSON.stringify({
      ts: new Date().toISOString(),
      topic: topics.metadataTopic(s),
      payload,
    }, null, 2));
  } catch (e) {
    sdk.logEvent(`abound: WARN could not persist last payload: ${e.message}`);
  }

  const hash = sha256(payload);
  let prev = null;
  try { prev = fs.readFileSync(HASH_PATH, "utf8"); } catch (_) {}
  if (!force && prev === hash) {
    sdk.logEvent("abound: metadata unchanged (hash match), skipping publish");
    return;
  }

  const topic = topics.metadataTopic(s);
  const c = await broker.connect(s);
  await broker.publish(c, topic, payload);

  try { fs.writeFileSync(HASH_PATH, hash); } catch (e) {
    sdk.logEvent(`abound: WARN could not persist hash: ${e.message}`);
  }

  const assetCount = payload._locations.reduce((n, l) => n + (l._assetList || []).length, 0);
  sdk.logEvent(`abound: published metadata → ${topic} (${locations.length} locations, ${assetCount} assets)`);
};

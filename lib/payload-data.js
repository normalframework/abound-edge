// Build openmqtt livedata payloads.
//
// Shape (per Carrier "Abound Edge MQTT Interface 0.8_WOA"):
// {
//   "livedata": {
//     "_id": "<controllerId>",
//     "_unixtime": "<ms>",
//     "devices": [
//       { "_comm": "0|1", "_id": "<deviceId>", "data": { "<pointName>": "<valueString>", ... } }
//     ]
//   }
// }

function stringifyValue(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    // NF latestValue can be {real: N} or similar
    if ("real" in v) return String(v.real);
    if ("double" in v) return String(v.double);
    if ("signed" in v) return String(v.signed);
    if ("unsigned" in v) return String(v.unsigned);
    if ("boolean" in v) return v.boolean ? "1" : "0";
    if ("characterString" in v) return v.characterString;
    if ("value" in v) return String(v.value);
    return "";
  }
  return String(v);
}

function isFresh(lvTs, staleThresholdMs) {
  if (!lvTs) return false;
  const t = typeof lvTs === "string" ? Date.parse(lvTs) : lvTs;
  if (isNaN(t)) return false;
  return Date.now() - t <= staleThresholdMs;
}

// devices: [{ id, points: [{ name, latestValue:{value,ts} }] }]
function build(settings, devices) {
  const staleMs = (settings.schedule.staleThresholdMin || 30) * 60 * 1000;

  const devList = devices.map((dev) => {
    const data = {};
    let anyFresh = false;
    for (const p of dev.points) {
      const lv = p.latestValue || {};
      data[p.name] = stringifyValue(lv);
      if (isFresh(lv.ts, staleMs)) anyFresh = true;
    }
    return {
      _comm: anyFresh ? "0" : "1",
      _id: String(dev.id),
      data,
    };
  });

  return {
    livedata: {
      _id: String(settings.identity.edgeDeviceId),
      _unixtime: String(Date.now()),
      devices: devList,
    },
  };
}

module.exports = { build, stringifyValue, isFresh };

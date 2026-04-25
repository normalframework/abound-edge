// MQTT broker connection management. Reuses a single client per module lifetime.

const mqtt = require("mqtt");

let client = null;
let lastKey = null;

function connectionKey(s) {
  return [s.broker.host, s.broker.port, s.broker.tls, s.broker.username, s.identity.edgeDeviceId]
    .join("|");
}

function connect(settings) {
  const key = connectionKey(settings);
  if (client && client.connected && lastKey === key) return Promise.resolve(client);
  if (client) {
    try { client.end(true); } catch (_) {}
    client = null;
  }

  const proto = settings.broker.tls ? "mqtts" : "mqtt";
  const url = `${proto}://${settings.broker.host}:${settings.broker.port}`;
  const opts = {
    clientId: `nf_${settings.identity.edgeDeviceId}_${settings.identity.assetGroupId}_${Math.floor(Math.random() * 1e6)}`,
    username: settings.broker.username || undefined,
    password: settings.broker.password || undefined,
    reconnectPeriod: 2000,
    connectTimeout: 10000,
    clean: true,
  };
  if (settings.broker.tls) {
    opts.rejectUnauthorized = !settings.broker.insecure;
    if (settings.broker.caPem) opts.ca = settings.broker.caPem;
  }

  return new Promise((resolve, reject) => {
    const c = mqtt.connect(url, opts);
    const timer = setTimeout(() => {
      try { c.end(true); } catch (_) {}
      reject(new Error(`Timed out connecting to ${url}`));
    }, opts.connectTimeout + 2000);

    c.once("connect", () => {
      clearTimeout(timer);
      client = c;
      lastKey = key;
      resolve(c);
    });
    c.once("error", (err) => {
      clearTimeout(timer);
      try { c.end(true); } catch (_) {}
      reject(err);
    });
  });
}

function publish(c, topic, message, options = { qos: 1 }) {
  return new Promise((resolve, reject) => {
    c.publish(topic, JSON.stringify(message), options, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function disconnect() {
  if (client) {
    try { client.end(true); } catch (_) {}
    client = null;
    lastKey = null;
  }
}

module.exports = { connect, publish, disconnect };

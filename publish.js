const NormalSdk = require("@normalframework/applications-sdk");
const mqtt = require('mqtt');

let globalMqttClient = null;

async function connect({

  edge_device_id,
  asset_group_id,
  mqtt_password,
  mqtt_username,
  mqtt_hostname
}) {
  const brokerUrl = `mqtt://${mqtt_hostname}`;
  const clientId = `client_${edge_device_id}_${asset_group_id}`;

  // If a connection exists, check if it's still connected
  if (globalMqttClient && globalMqttClient.connected) {
    console.log('Reusing existing MQTT connection.');
    return globalMqttClient;
  }

  // Create a new connection
  const options = {
    clientId,
    username: mqtt_username,
    password: mqtt_password,
    reconnectPeriod: 1000,
    connectTimeout: 5000,
    clean: true
  };

  return new Promise((resolve, reject) => {
    const client = mqtt.connect(brokerUrl, options);

    client.on('connect', () => {
      console.log(`MQTT connected as ${clientId}`);
      globalMqttClient = client;
      resolve(client);
    });

    client.on('error', (err) => {
      console.error('MQTT connection error:', err);
      client.end();
      reject(err);
    });

    client.on('close', () => {
      console.log('MQTT connection closed');
    });
  });
}
// Promisified publish
function publishAsync(client, topic, message, options = { qos: 1 }) {
  return new Promise((resolve, reject) => {
    client.publish(topic, JSON.stringify(message), options, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Invoke hook function
 * @param {NormalSdk.InvokeParams} params
 * @returns {NormalSdk.InvokeResult}
 */
module.exports = async ({points, sdk, config, args}) => {
    let conn = await connect(config)

    let values = {}
    for (let i = 0; i < points.length; i++) {
        if (points[i].attrs.class !== undefined) {
            values[points[i].attrs.class] = points[i].latestValue.valueString
        }
    }
    console.log(values)

  let payload = {
    _id: config.edge_device_id,
    _ts:  Date.now(),
    data: [
            {
               _comm: "0",
               _id: sdk.groupKey,
                _ts: "",
                ...values
            }
        ]
    }
    await publishAsync(conn, 
        `CORTIXedgeData/${config.asset_group_id}/o/${config.edge_device_id}`,
        payload)
};
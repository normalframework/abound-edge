// Abound Edge topic builders. Spec: <msg_type>/<asset_group>/<direction>/<controller_id>/<payload_type>

function dataTopic(s) {
  const { assetGroupId, edgeDeviceId } = s.identity;
  return `CORTIXedgeData/${assetGroupId}/i/${edgeDeviceId}/openmqtt`;
}

function metadataTopic(s, version = "v0.8_WOA") {
  const { assetGroupId, edgeDeviceId } = s.identity;
  return `CORTIXedgeMeta/${assetGroupId}/i/${edgeDeviceId}/${version}`;
}

module.exports = { dataTopic, metadataTopic };

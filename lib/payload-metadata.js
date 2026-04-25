// Build CORTIXedgeMeta payloads.
//
// Shape (per Appendix 1.0):
// {
//   "_ver": "0.8_WOA",
//   "_conID": "...", "_accID": "...", "_subID": "...",
//   "_org": { "_id", "_name", "_contact", "_email", "info": {...} },
//   "_locations": [
//     { "_id", "_siteName", "_address", "_latitude", "_longitude",
//       "_tempUOM", "_timeZone", "info": {...},
//       "_assetList": [ { "_id", "_type", "info": {...} }, ... ] }
//   ]
// }

function s(v) { return v === null || v === undefined ? "" : String(v); }

// location: { id, siteName, address, latitude, longitude, tempUOM, timeZone, info, assetList: [...] }
// assetList item: { id, type, info }
function build(settings, locations) {
  const org = settings.org || {};
  return {
    _ver: "0.8_WOA",
    _conID: s(settings.identity.edgeDeviceId),
    _accID: s(settings.identity.accId),
    _subID: s(settings.identity.subId),
    _org: {
      _id: s(org.id),
      _name: s(org.name),
      _contact: s(org.contact),
      _email: s(org.email),
      info: org.info || {},
    },
    _locations: locations.map((loc) => ({
      _id: s(loc.id),
      _siteName: s(loc.siteName),
      _address: s(loc.address),
      _latitude: s(loc.latitude),
      _longitude: s(loc.longitude),
      _tempUOM: s(loc.tempUOM || "F"),
      _timeZone: s(loc.timeZone || "UTC"),
      info: loc.info || {},
      _assetList: (loc.assetList || []).map((a) => ({
        _id: s(a.id),
        _type: s(a.type || "Unknown"),
        info: a.info || {},
      })),
    })),
  };
}

module.exports = { build };

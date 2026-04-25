// Normal Framework REST API helpers. Uses sdk.http (Axios) available inside hooks.

async function listSites(sdk) {
  let offset = 0;
  const pageSize = 100;
  const all = [];
  while (true) {
    const resp = await sdk.http.get("/api/v1/sites", {
      params: { pageSize, pageOffset: offset },
    });
    const rows = resp.data?.sites || [];
    all.push(...rows);
    const next = parseInt(resp.data?.nextPageOffset || "0", 10);
    if (!next || rows.length < pageSize) break;
    offset = next;
  }
  return all;
}

async function listEquipmentTypes(sdk) {
  const resp = await sdk.http.get("/api/v1/equipment/types", {
    params: { pageSize: 500 },
  });
  return resp.data?.equipmentTypes || [];
}

// Paginated structured query. Uses layer "default" so latestValue is attached.
async function queryPoints(sdk, structuredQuery, extra = {}) {
  const out = [];
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const body = {
      pageSize,
      pageOffset: offset,
      layer: "default",
      responseFormat: "LAYERS_COLLAPSED",
      structuredQuery,
      ...extra,
    };
    const resp = await sdk.http.post("/api/v1/point/query", body);
    const rows = resp.data?.points || [];
    out.push(...rows);
    const next = parseInt(resp.data?.nextPageOffset || "0", 10);
    if (!next || rows.length < pageSize) break;
    offset = next;
  }
  return out;
}

async function facetValues(sdk, attr) {
  const resp = await sdk.http.get("/api/v1/point/attributes", {
    params: { attrs: [attr], pageSize: 1000 },
  });
  const out = [];
  for (const g of resp.data?.attrs || []) {
    for (const v of g.values || []) {
      if (v.value !== undefined && v.value !== "") {
        out.push({ value: v.value, count: parseInt(v.count, 10) || 0 });
      }
    }
  }
  return out;
}

module.exports = { listSites, listEquipmentTypes, queryPoints, facetValues };

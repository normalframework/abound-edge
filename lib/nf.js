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

// Paginated structured query. Uses layer "default" so latestValue + presentation
// fields (enum, units) are attached (and any conversion is applied on read).
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
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

// Page through every point (optionally filtered). Pages by offset increment so
// it doesn't depend on nextPageOffset; capped to avoid runaway loops.
async function queryAllPoints(sdk, structuredQuery) {
  const out = [];
  const pageSize = 500;
  const MAX_PAGES = 80;
  for (let i = 0, offset = 0; i < MAX_PAGES; i++, offset += pageSize) {
    const body = { pageSize, pageOffset: offset, layer: "default", responseFormat: "LAYERS_COLLAPSED" };
    if (structuredQuery) body.structuredQuery = structuredQuery;
    const resp = await sdk.http.post("/api/v1/point/query", body);
    const rows = resp.data?.points || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

module.exports = { listSites, listEquipmentTypes, queryPoints, queryAllPoints };

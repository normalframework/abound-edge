// NF conversion subsystem REST helpers (normalgw.hpl.v1 PointManager).
//
// The MCP `manage_conversions` wrapper only exposes linear/boolean/js steps,
// but the real proto also supports:
//   - ConversionStep.enum_mapping = { mapping: map<int32,int32> }  (value remap)
//   - Conversion.output_enum     = { values: [labels], isZeroIndexed }  (relabel)
// Conversions apply on the read path; raw timeseries is always preserved.
// Associate with points by setting conversion_id via UpdatePoints.

async function listConversions(sdk) {
  const resp = await sdk.http.get("/api/v1/point/conversions");
  return resp.data?.conversions || [];
}

async function createConversion(sdk, conversion) {
  const resp = await sdk.http.post("/api/v1/point/conversions", { conversion });
  return resp.data?.conversion || resp.data;
}

async function updateConversion(sdk, conversion) {
  const resp = await sdk.http.put("/api/v1/point/conversions", { conversion });
  return resp.data?.conversion || resp.data;
}

async function deleteConversion(sdk, id) {
  await sdk.http.delete(`/api/v1/point/conversions/${encodeURIComponent(id)}`);
}

// Associate a conversion with points (partial UpdatePoints by uuid; backend
// merges, leaving name/attrs intact). points: [{ uuid, layer }].
async function applyToPoints(sdk, conversionId, points) {
  if (!points.length) return 0;
  const body = {
    points: points.map((p) => ({ uuid: p.uuid, layer: p.layer || "hpl:point", conversionId })),
    isAsync: false,
  };
  await sdk.http.post("/api/v1/point/points", body);
  return points.length;
}

// Clear conversion_id from points.
async function clearFromPoints(sdk, points) {
  if (!points.length) return 0;
  const body = {
    points: points.map((p) => ({ uuid: p.uuid, layer: p.layer || "hpl:point", conversionId: "" })),
    isAsync: false,
  };
  await sdk.http.post("/api/v1/point/points", body);
  return points.length;
}

module.exports = { listConversions, createConversion, updateConversion, deleteConversion, applyToPoints, clearFromPoints };

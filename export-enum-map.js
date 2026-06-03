// Export the enum data the dashboard needs to build a two-tab Excel workbook:
//   - /config/enum-export.json : { lists:[...], points:[...] } for the workbook
//   - /config/enum-map.csv     : the Mappings sheet as plain CSV (fallback)
// Built entirely on each point's populated Point.enum; grouped by distinct list.

const fs = require("fs");
const path = require("path");

const enums = require("./lib/enums");
const nf = require("./lib/nf");

const EXPORT_JSON = path.join(__dirname, "config", "enum-export.json");
const CSV_PATH = path.join(__dirname, "config", "enum-map.csv");

module.exports = async ({ sdk }) => {
  const points = await nf.queryAllPoints(sdk);
  const withEnum = points.filter(enums.hasEnum);
  const exp = enums.buildExport(withEnum);

  const dir = path.dirname(EXPORT_JSON);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(EXPORT_JSON, JSON.stringify(exp));
  fs.writeFileSync(CSV_PATH, enums.buildCsv(withEnum));

  const lists = Object.keys(enums.distinctLists(withEnum)).length;
  sdk.logEvent(`abound: exported ${lists} distinct enum lists (${withEnum.length} points) → enum-export.json + enum-map.csv`);
  return { ok: true, lists, points: withEnum.length };
};

// Import a filled enum workbook/CSV (args.csv). For each EDITED list (≥1 row with
// a non-blank target_value or target_label) create/update one NF Conversion
// (enum_mapping value-remap + output_enum relabel) and apply it to every point
// sharing that enum list. Lists you didn't map get no conversion; any previously
// created conversion for a now-unmapped list is deleted (reconcile). Conversions
// apply on the read path, so the publish payload picks up the values automatically.

const fs = require("fs");
const path = require("path");

const enums = require("./lib/enums");
const conv = require("./lib/conversions");
const nf = require("./lib/nf");

const DEBUG_PATH = path.join(__dirname, "config", ".import-debug.json");

module.exports = async ({ sdk, args }) => {
  const csv = args && args.csv;
  if (!csv) throw new Error("missing args.csv (the filled workbook/CSV content)");

  const rows = enums.parseCsv(csv);
  const summary = enums.targetSummary(rows);
  try { fs.writeFileSync(DEBUG_PATH, JSON.stringify({ totalRows: rows.length, perList: summary }, null, 2)); } catch (_) {}

  const specs = enums.buildSpecs(rows);
  const editedIds = new Set(Object.keys(specs));

  // Re-query points to find which points belong to each distinct list (by signature).
  const points = (await nf.queryAllPoints(sdk)).filter(enums.hasEnum);
  const groups = enums.distinctLists(points);
  const state = enums.loadConvState(); // listId -> conversionId

  let created = 0, updated = 0, applied = 0, removed = 0;

  for (const listId of editedIds) {
    const spec = specs[listId];
    const conversion = {
      name: `Abound enum ${listId}`,
      description: "Abound DMS enum value mapping + label override",
      category: "Abound",
      steps: spec.hasMapping ? [{ enumMapping: { mapping: spec.mapping } }] : [],
      outputEnum: spec.outputEnum,
    };

    let convId = state[listId];
    try {
      if (convId) {
        await conv.updateConversion(sdk, { id: convId, ...conversion });
        updated++;
      } else {
        const c = await conv.createConversion(sdk, conversion);
        convId = c && c.id;
        if (!convId) throw new Error("create returned no conversion id");
        state[listId] = convId;
        created++;
      }
    } catch (e) {
      sdk.logEvent(`abound: ERROR conversion for ${listId}: ${e.message}`);
      continue;
    }

    const grp = groups[listId];
    if (grp && grp.points.length) {
      try { applied += await conv.applyToPoints(sdk, convId, grp.points); }
      catch (e) { sdk.logEvent(`abound: WARN apply ${listId} failed: ${e.message}`); }
    }
  }

  // Reconcile: the uploaded workbook is the complete desired state. Delete
  // conversions for any list that is no longer mapped (clears them from points).
  for (const [lid, convId] of Object.entries(state)) {
    if (editedIds.has(lid)) continue;
    try { await conv.deleteConversion(sdk, convId); removed++; }
    catch (e) { sdk.logEvent(`abound: WARN delete ${lid} failed: ${e.message}`); }
    delete state[lid];
  }

  enums.saveConvState(state);
  sdk.logEvent(`abound: enum conversions — ${created} created, ${updated} updated, ${removed} removed, applied to ${applied} points (${editedIds.size} edited of ${Object.keys(summary).length} lists)`);
  return { ok: true, edited: editedIds.size, created, updated, removed, applied };
};

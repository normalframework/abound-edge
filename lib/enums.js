// Enumerated-point handling, built entirely on the canonical Point.enum
// (PointEnum { values:[label], isZeroIndexed }) — we assume the ingestion
// source populates it. We group points by their DISTINCT enum list, export one
// CSV/workbook row per (list, source state), and on import turn each EDITED list
// into one NF Conversion (enum_mapping value-remap + output_enum relabel)
// applied to every point sharing that list.

const fs = require("fs");
const path = require("path");

// listId -> conversionId, so re-imports update existing conversions in place.
const CONV_STATE_PATH = path.join(__dirname, "..", "config", "enum-conversions.json");
const CSV_HEADER = ["list_id", "point_count", "raw_value", "source_label", "target_value", "target_label"];

// ---- enum metadata ---------------------------------------------------------

function hasEnum(p) {
  return !!(p && p.enum && Array.isArray(p.enum.values) && p.enum.values.length);
}

// BACnet-style enums are 1-indexed unless isZeroIndexed; index i -> raw value.
function baseIndex(en) {
  return en && en.isZeroIndexed ? 0 : 1;
}

function signature(en) {
  return JSON.stringify({ v: en.values, z: !!en.isZeroIndexed });
}

// Deterministic short id for a distinct enum list (stable across runs).
function hashId(sig) {
  let h = 5381;
  for (let i = 0; i < sig.length; i++) h = ((h << 5) + h + sig.charCodeAt(i)) >>> 0;
  return "enum-" + h.toString(36);
}
function listId(en) { return hashId(signature(en)); }

// Group points by enum signature.
// -> { [listId]: { listId, enum, signature, points:[{uuid,layer}], count } }
function distinctLists(points) {
  const groups = {};
  for (const p of points) {
    if (!hasEnum(p)) continue;
    const sig = signature(p.enum);
    const id = hashId(sig);
    if (!groups[id]) groups[id] = { listId: id, enum: p.enum, signature: sig, points: [], count: 0 };
    groups[id].points.push({ uuid: p.uuid, layer: p.layer });
    groups[id].count++;
  }
  return groups;
}

// ---- exports for the dashboard workbook -----------------------------------

// Rows for the editable "Mappings" sheet: one per (list, source state).
function listRows(points) {
  const groups = distinctLists(points);
  const rows = [];
  for (const g of Object.values(groups)) {
    const base = baseIndex(g.enum);
    g.enum.values.forEach((label, i) => {
      rows.push({ list_id: g.listId, point_count: g.count, raw_value: base + i, source_label: label });
    });
  }
  return rows;
}

// Rows for the reference "Points" sheet: which point uses which enum list.
function pointRows(points) {
  const rows = [];
  for (const p of points) {
    if (!hasEnum(p)) continue;
    const a = p.attrs || {};
    rows.push({
      site: a.siteRef || "",
      equip: a.equipRef || a.path || "",
      point: p.name || "",
      list_id: listId(p.enum),
      states: p.enum.values.join(" | "),
    });
  }
  return rows;
}

// Everything the browser needs to build the two-tab workbook.
function buildExport(points) {
  return { lists: listRows(points), points: pointRows(points) };
}

// ---- CSV export (kept as a fallback) --------------------------------------

function csvCell(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(points) {
  const lines = [CSV_HEADER.join(",")];
  for (const r of listRows(points)) {
    lines.push(CSV_HEADER.map((h) => csvCell({ ...r, target_value: "", target_label: "" }[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

// ---- CSV import ------------------------------------------------------------

// Minimal RFC4180 parser → array of row objects keyed by header.
function parseCsv(text) {
  const rows = [];
  let field = "", row = [], inQ = false;
  const s = String(text).replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQ) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); field = ""; row = []; }
    else if (c === "\r") { /* handled by \n */ }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => { const o = {}; header.forEach((h, i) => (o[h] = r[i] !== undefined ? r[i] : "")); return o; });
}

const cell = (v) => String(v === undefined || v === null ? "" : v).trim();

// Build per-list conversion spec — ONLY for lists with at least one real edit
// (a non-blank target_value or target_label). Untouched lists get no conversion.
// -> { [listId]: { mapping:{rawV:tgtV}, hasMapping, outputEnum:{values,isZeroIndexed} } }
function buildSpecs(rows) {
  const byList = {};
  const edited = {};
  for (const r of rows) {
    const id = cell(r.list_id);
    const raw = cell(r.raw_value);
    if (!id || raw === "") continue;
    const rawV = parseInt(raw, 10);
    if (Number.isNaN(rawV)) continue;

    const tv = cell(r.target_value);
    const tl = cell(r.target_label);
    if (tv !== "" || tl !== "") edited[id] = true;       // this list was touched

    const tgtV = tv === "" ? rawV : parseInt(tv, 10);
    const tgtL = tl || cell(r.source_label);
    (byList[id] || (byList[id] = [])).push({ rawV, tgtV: Number.isNaN(tgtV) ? rawV : tgtV, tgtL });
  }

  const specs = {};
  for (const [id, rs] of Object.entries(byList)) {
    if (!edited[id]) continue;                            // skip untouched lists

    const mapping = {};
    let hasMapping = false;
    for (const r of rs) if (r.tgtV !== r.rawV) { mapping[r.rawV] = r.tgtV; hasMapping = true; }

    const finals = rs.map((r) => r.tgtV);
    const zero = Math.min(...finals) === 0;
    const base = zero ? 0 : 1;
    const maxV = Math.max(...finals);
    const values = new Array(Math.max(0, maxV - base + 1)).fill("");
    for (const r of rs) { const idx = r.tgtV - base; if (idx >= 0) values[idx] = r.tgtL; }

    specs[id] = { mapping, hasMapping, outputEnum: { values, isZeroIndexed: zero } };
  }
  return specs;
}

// Diagnostic: per-list row + edited-row counts (so we can confirm targets arrive).
function targetSummary(rows) {
  const per = {};
  for (const r of rows) {
    const id = cell(r.list_id);
    if (!id) continue;
    const touched = cell(r.target_value) !== "" || cell(r.target_label) !== "";
    const d = per[id] || (per[id] = { rows: 0, withTarget: 0 });
    d.rows++; if (touched) d.withTarget++;
  }
  return per;
}

// ---- conversion-id state persistence --------------------------------------

function loadConvState() {
  try { return JSON.parse(fs.readFileSync(CONV_STATE_PATH, "utf8")); } catch (_) { return {}; }
}
function saveConvState(state) {
  const dir = path.dirname(CONV_STATE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONV_STATE_PATH, JSON.stringify(state, null, 2));
}

module.exports = {
  hasEnum, baseIndex, signature, listId, distinctLists,
  listRows, pointRows, buildExport, buildCsv, parseCsv, buildSpecs, targetSummary,
  loadConvState, saveConvState, CSV_HEADER, CONV_STATE_PATH,
};

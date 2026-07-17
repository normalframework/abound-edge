// Deterministic two-level identifiers for the DMS device-model payload.
//
//   _id   = "<siteId>.id/<equipSlug>.id"   e.g. "cedarpark.id/VMA-30.id"
//   _path = "<siteName>/<equipRef display>" e.g. "Cedar Park.../...VAV Box 30 (VMA-30)"
//
// equipSlug prefers a short code embedded in the equipRef (VMA-30, UNT-14, RTU-3),
// falling back to a slug of the whole equipRef so the id is always stable + unique.

// Short codes look like 2-5 uppercase letters, a dash, and digits: VMA-30, UNT-14, AHU-1.
const SHORT_CODE_RE = /\b([A-Z]{2,5}-\d+[A-Za-z]?)\b/;

function slug(s) {
    return String(s || "")
      .trim()
      .replace(/[^a-zA-Z0-9]+/g, "-")   // preserve case; only collapse non-alphanumerics
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "equip";
  }   


function shortCode(equipRef) {
  const m = String(equipRef || "").match(SHORT_CODE_RE);
  return m ? m[1] : null;
}

// Stable per-equipment slug used in _id. Short code wins; otherwise slug the ref.
function equipSlug(equipRef) {
  return shortCode(equipRef) || slug(equipRef);
}

function equipId(siteRef, equipRef) {
  return `${siteRef}.id/${equipSlug(equipRef)}.id`;
}

function equipPath(siteName, equipRef) {
  return `${siteName || ""}/${equipRef || ""}`;
}

module.exports = { slug, shortCode, equipSlug, equipId, equipPath, SHORT_CODE_RE };

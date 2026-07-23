// Deterministic two-level identifiers for the DMS device-model payload.
//
//   _id   = "<siteId>/<equipSlug>"          e.g. "cedarpark/VMA-30"
//   _path = "<siteName>/<equipRef>"                        (base form), or
//           "<siteName>/<areaServed>/<equipServes>/<equipRef>" when both the
//           area_served and equip_serves attrs are present for the equipment.
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
  return `${siteRef}/${equipSlug(equipRef)}`;
}

// A "/" is the DMS path separator, so it can never appear inside a single path
// segment — strip any slashes out of the free-text area_served / equip_serves
// values (collapsing the whitespace they leave behind).
function pathSegment(s) {
  return String(s || "").replace(/\//g, " ").replace(/\s+/g, " ").trim();
}

// Build the DMS _path for an equipment. When BOTH area_served and equip_serves
// are known (non-empty after sanitizing), emit the 4-part hierarchy:
//   <siteName>/<areaServed>/<equipServes>/<equipRef>
// Otherwise fall back to the 2-part <siteName>/<equipRef>.
function equipPath(siteName, equipRef, areaServed, equipServes) {
  const site = siteName || "";
  const ref = equipRef || "";
  const area = pathSegment(areaServed);
  const equip = pathSegment(equipServes);
  if (area && equip) return `${site}/${area}/${equip}/${ref}`;
  return `${site}/${ref}`;
}

module.exports = { slug, shortCode, equipSlug, equipId, equipPath, pathSegment, SHORT_CODE_RE };

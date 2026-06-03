# Abound DMS

Publish NF equipment point data to the Carrier Abound **Data Ingestion Service
(DIS v2.0) REST API** — one OAuth2-authenticated POST per site to
`/v1/dms/data`, built from streamed point values.

Configured entirely through its dashboard (the app's `static/` page). Settings
persist to `config/settings.json`; equipment-class → Carrier-type overrides to
`config/mapping.json`.

## What it sends

For each **enabled site**, one HTTPS `POST <baseUrl>/v1/dms/data` with the DMS
device-model body:

```jsonc
{
  "systemId": "<systemId>",
  "data": [
    {
      "<point-class>": "<stringValue>", ...,   // one entry per classified point
      "_ts":   "<ms epoch>",   // re-stamped to the 15-min grid (see Timestamps)
      "_id":   "<siteId>.id/<equipShortCode>.id",
      "_path": "<siteName>/<equipRef>",
      "_comm": "0.0",          // 0.0 = communicating, 1.0 = stale (INVERTED vs MQTT)
      "_model": "VAV"          // mapped from the equipment class; omitted if unknown
    }
  ]
}
```

Equipment are grouped by `equipRef`. `_model` comes from the **equipment class**
(`vav`/`ahu`/…) mapped via `nfTypeToCarrier` — not the point class. Enumerated
points are remapped/relabeled by NF Conversions (see Enums).

## Architecture (streaming, one invocation per site)

`publish-data` is a **scheduled (15 min) + `siteRef`-grouped + points-bound**
hook. The framework streams each enabled site's points (with `latestValue`,
already conversion-applied on read) into a per-site invocation — there are **no
point/equipment API queries** in the publish path. The stream contains both
data points and the equipment-instance records (`markers` ~ `equip`), the latter
used only to resolve `_model`.

`configure-publish` rebinds `publish-data`'s point query to the enabled sites
(via `UpdateHook`, no restart needed) and clears the token cache; the dashboard
calls it on **Save**.

## Timestamps

Abound treats incoming data as change-of-value, so each run **re-stamps every
point's equipment `_ts` to the current 15-min grid** (`:00/:15/:30/:45` UTC),
shared across the site — so unchanged values still ingest as fresh samples.
`_comm` is the real freshness: `0.0` if any point updated within
`schedule.staleThresholdMin`, else `1.0`.

## Enums (NF Conversions)

Enum value-remapping and relabeling are done with **NF Conversions** (which
apply on the read path, so published values pick them up automatically):

1. **Generate / Download** a two-tab `.xlsx` of the **distinct `Point.enum`
   lists** (Mappings tab) plus which points use each list (Points tab).
2. Fill `target_value` (the integer Abound should receive) and/or
   `target_label` (the label shown in NF) on the Mappings tab.
3. **Upload** — for each *edited* list, create/update one `Conversion`
   (`enum_mapping` value remap + `output_enum` relabel) and apply it to every
   point sharing that list. The uploaded workbook is the full desired state;
   lists left untouched get no conversion, and clearing a list removes it.

`config/enum-conversions.json` tracks list → conversion-id.

## Token handling

OAuth2 client-credentials, cached to `config/.dms-token.json`:
- reused until ~60s before expiry, then refreshed;
- `401` on POST → force-refresh + one retry;
- atomic cache writes + a cross-process single-flight lock (so per-site
  invocations don't stampede the IdP or corrupt the cache);
- cache cleared by `configure-publish` on Save, so credential changes apply
  immediately.

## Hooks

```
publish-data.js       scheduled (15min), grouped by siteRef: build + POST per site
configure-publish.js  manual: rebind publish-data to enabled sites + clear token
test-publish.js       manual: acquire token + GET /v1/dms/data probe
export-enum-map.js    manual: distinct Point.enum lists → enum-export.json + enum-map.csv
import-enum-map.js    manual: workbook → create/apply NF Conversions
save-settings.js      manual: write config/settings.json (dashboard usually writes directly)
```

## Layout

```
lib/
  settings.js     load/save settings.json (dms, schedule, sites)
  dms-client.js   OAuth2 token (cache/refresh/single-flight) + postData + ping
  payload-dms.js  build the per-site device-model body (grid _ts, _comm, _model)
  ids.js          deterministic _id / _path from siteRef + equipRef
  mapping.js      equipment class → Carrier asset type (for _model)
  enums.js        Point.enum distinct lists, workbook/CSV, conversion specs
  conversions.js  NF conversion REST helpers (enum_mapping + output_enum)
  nf.js           sdk.http REST helpers (queryAllPoints, listSites, ...)

config/
  default-mapping.json  shipped nfTypeToCarrier defaults
  mapping.json          user overrides (written by dashboard)
  settings.json         dms connection, schedule, sites
  (runtime, gitignored) .dms-token.json, .last-data-<site>.json,
                        enum-map.csv, enum-export.json, enum-conversions.json

static/                 dashboard SPA (index.html, app.js, utils.js, styles.css)
docs/                   Carrier DIS interface PDF
```

## Required configuration

The plugin no-ops until all of the following are set (`settingsLib.isConfigured`):

- `dms.baseUrl`   — e.g. `https://ingest.ws.insights.cortix.ai`
- `dms.tokenUrl`  — OAuth2 token endpoint
- `dms.clientId`, `dms.clientSecret`
- `dms.systemId`  — the source-system id, sent in every POST

Set `dms.verifyTls: false` to skip TLS verification (test only). Enable the
sites to publish on the **Sites** tab; Save rebinds the publisher.

# Abound Edge

Publish NF point data and metadata to a Carrier Abound Edge MQTT broker.

The plugin is configured entirely through its dashboard (the app's `static/`
page) — there are no `app.json` options. Settings persist to
`config/settings.json`; user type-mapping overrides persist to
`config/mapping.json`.

## What it sends

Two MQTT topics, per the Carrier Abound Edge MQTT Interface spec
(see `docs/`):

| Purpose  | Topic                                                                         | Cadence            |
|----------|-------------------------------------------------------------------------------|--------------------|
| Live data | `CORTIXedgeData/<assetGroupId>/i/<edgeDeviceId>/openmqtt`                     | every 15 min       |
| Metadata  | `CORTIXedgeMeta/<assetGroupId>/i/<edgeDeviceId>/v0.8_WOA`                     | daily, hash-skipped |
| Probe     | `CORTIXedgeData/<assetGroupId>/i/<edgeDeviceId>/openmqtt.probe`               | manual (test)      |

Metadata publishes are skipped when the rendered payload's SHA-256 matches
the previously sent one (stored in `config/.metadata-hash`). Run
`publish-metadata-now` to force a send.

## Modes

Set via `mode` in settings. Both modes resolve enabled sites from
`settings.sites[siteId].enabled`.

- **modeled** (default) — group points by `equipRef`, look up the equipment
  record on the model layer, and prefer a short-form record (e.g. `VMA-7`)
  over a long-form one when its name is a substring of the long
  `equipRef`. Point keys in the payload are the `class` attribute.
  Equipment `class` is mapped to a Carrier asset type via
  `nfTypeToCarrier` (see `config/default-mapping.json`).
- **raw** — group points by `device_id` (BACnet). Point keys in the payload
  are the raw object name. Asset type comes from `bacnetVendorToCarrier`
  keyed by `"<vendor> <model>"`.

Unmapped types fall back to `"Unknown"`.

## Layout

```
publish-data.js          scheduled (15min): build + send livedata
publish-metadata.js      scheduled (daily): build + hash-diff + send metadata
publish-now.js           manual: alias for publish-data
publish-metadata-now.js  manual: forces metadata publish (skips hash check)
test-publish.js          manual: sends a probe message to the data topic
save-settings.js         manual: dashboard → config/settings.json
save-mapping.js          manual: dashboard → config/mapping.json

lib/
  settings.js     load/save settings.json with DEFAULTS merge
  mapping.js      load default + user mapping; resolve NF/BACnet → Carrier type
  broker.js       MQTT connect (mqtts/mqtt) with single cached client
  topics.js       data/metadata topic builders
  payload-data.js     build openmqtt livedata payload (with _comm freshness flag)
  payload-metadata.js build CORTIXedgeMeta payload
  mode-modeled.js collect locationsAssets + devices from NF model layer
  mode-raw.js     collect locationsAssets + devices from raw BACnet points
  nf.js           thin wrappers around sdk point/equipment queries
  sites.js        enrich locations with site-level attrs (address, geo, tz)

config/
  default-mapping.json  shipped defaults for nfTypeToCarrier
  mapping.json          user overrides (written by dashboard)
  settings.json         broker, identity, org, mode, schedule, sites
  .metadata-hash        last published metadata hash (skip-if-match)
  .last-data-payload.json
  .last-metadata-payload.json   most recent rendered payloads (dashboard preview)

static/                 dashboard SPA (index.html, app.js, utils.js, styles.css)
docs/                   Carrier-supplied MQTT interface PDFs
```

## Required configuration

The plugin will no-op until all of the following are set
(`settingsLib.isConfigured`):

- `broker.host`
- `identity.assetGroupId`
- `identity.edgeDeviceId`

Broker defaults: TLS on, port 5083. Set `broker.insecure: true` to skip cert
verification, or pass a CA in `broker.caPem`.

## Freshness

Each device in the livedata payload carries `_comm`: `"0"` if any of its
points has a timestamp newer than `schedule.staleThresholdMin` minutes ago,
`"1"` otherwise.

## Local development

The Port of Seattle demo site (Demo tenant on normal-online.net) targets a
local docker-compose EMQX as a stand-in for the Abound broker — see
`demo/docker-compose.yml` and `demo/emqx/emqx.conf` in the gobac repo.

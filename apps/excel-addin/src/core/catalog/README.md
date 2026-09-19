# core/catalog

Reads the nightly **model capability catalog** and merges it into OpenRouter's
live model list. The catalog is built on the droplet by
[`server/model-catalog/`](../../../server/model-catalog/README.md) from
Artificial Analysis benchmark data; this module is the pane-side consumer.

## Public interface

```ts
import { enrichModels, fetchModelCatalog } from "./core/catalog";

const [models, catalog] = await Promise.all([client.listModels(apiKey), fetchModelCatalog()]);
const enriched = enrichModels(models, catalog); // ModelInfo[] with capability / releasedAt / speed
```

- `fetchModelCatalog({ force?, fetchImpl? })` — GETs the same-origin
  `/data/model-catalog.json` once per pane session (module-level cached
  promise). Resolves **null** when the file is missing, malformed or the pane
  is offline; null is not cached, so a later mount retries.
- `enrichModels(models, catalog)` — pure. Sets `capability`,
  `capabilityByEffort`, `releasedAt` (unix seconds) and
  `outputTokensPerSecond` on matched models; unmatched models pass through.
  Falls back from `vendor/model:free` to `vendor/model`.
- `parseModelCatalog(raw)` — defensive validator; rejects any schema other
  than 1 and drops malformed entries individually.

## Rules

- The catalog is **enrichment only**. The picker must render correctly with
  `catalog === null`; nothing here may block or fail the OpenRouter list.
- Same-origin by design: no CORS, no CSP change, no new trusted host. Vite
  proxies `/data` to the dev droplet like the other instance-served paths.
- No Artificial Analysis key ever reaches this module or the bundle.

## Tests

- [`merge.test.ts`](merge.test.ts) — enrichment, suffix fallback, date parsing
- [`fetch.test.ts`](fetch.test.ts) — caching, null on failure, retry after failure, schema rejection

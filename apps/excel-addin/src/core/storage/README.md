# core/storage

Settings, credentials, and conversation history.

## Phase 1 status

Implements the API-key + model-preference subset of the planned interface. Uses `OfficeRuntime.storage` directly — **no at-rest encryption yet**. Office's per-add-in storage is sandboxed from other add-ins; encryption is deferred as a defense-in-depth improvement.

## Public interface

```ts
import { createSettingsStore } from "./core/storage";

const settings = createSettingsStore();
await settings.setApiKey("sk-or-...");
await settings.setModelPref({ modelId: "anthropic/claude-opus-4-7", reasoning: "high" });
```

Types exported: `SettingsStore`, `StorageBackend`, `ModelPref`,
`ReasoningLevel`, and `AcreFreeSession`.

## Storage backend

`createSettingsStore` accepts an optional `StorageBackend`. Production Excel omits it and gets `OfficeRuntime.storage`. Tests and the **browser preview** (Vite at `https://localhost:3000` outside Excel) pass `inMemoryBackend()` so the OpenRouter key and A.CRE Free session stay in the JS heap for that page load and are **never written to disk, localStorage, IndexedDB, or the repo**.

```ts
// Tests and browser preview — key is not persisted
import { createSettingsStore, inMemoryBackend } from "./core/storage";
const settings = createSettingsStore(inMemoryBackend());
```

Do not add a `localStorage` backend for the API key. Office's per-add-in storage is sandboxed from other add-ins; encryption is deferred as a defense-in-depth improvement.

## Keys

- `excelente.openrouter.apiKey` — raw OpenRouter API key string
- `excelente.openrouter.modelPref` — JSON `{ modelId, reasoning }`
- `excelente.acreFree.session` — verified email display value, signed access
  token, and expiry; removable through **Sign out of A.CRE Free** in Settings

The `excelente.openrouter.` prefix avoids collisions with other settings.

## What's not implemented yet

- At-rest encryption (defense in depth)
- Conversation history (Phase 1.5 / Phase 7)
- Skills install registry (Phase 4)
- Per-session approval cache (Phase 3)

## Lands in

Phase 1 — Foundation for OpenRouter. Extends in Phase 4 (skills index) and Phase 7 (telemetry opt-in).

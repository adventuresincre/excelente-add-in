# core/modes

Mode presets. A mode is a curated system prompt + default skill enablement + UI theme tuned for a domain.

## Bundled modes (planned)

- `cre-underwriting` — CRE-first; A.CRE conventions; enables `direct-cap-valuation`, `dcf-modeling`, `waterfall-building`, `multifamily-underwriting`, `debt-sizing`
- `three-statement` — corporate finance 3-statement modeling
- `fpa` — FP&A: variance, forecasting, budget vs actual
- `data-cleanup` — cleaning, reconciling, normalizing
- `generic` — no preset; chat with whatever's selected

Mode is independent of model. Users mix-and-match.

## Public interface (planned, lands in Phase 7)

```ts
export interface Mode {
  id: string;
  name: string;
  systemPrompt: string;
  defaultSkills: string[];
  uiTheme?: ThemeOverrides;
}

export const modes: Mode[];
```

## Dependencies

- `core/skills` to reference bundled skills
- No Office.js dependency

## Lands in

Phase 7 — CRE modes + polish.

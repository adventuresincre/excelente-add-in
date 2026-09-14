# Suspending calculation mode

The single most important rule for multi-formula writes. Without it, Excel recalculates after every `ctx.sync()` against a partially-written model — phantom errors, hangs, and on large workbooks, crashes.

## The template

Wrap any script that writes 5+ interdependent formulas (anything multi-sheet, anything DCF / waterfall / debt schedule) in this:

```js
context.application.load("calculationMode");
await context.sync();
const saved = context.application.calculationMode;

context.application.calculationMode = Excel.CalculationMode.manual;
await context.sync();

try {
  // … all your formula writes across all sheets …
  // Multiple `await context.sync()` calls inside here are fine —
  // calc is suspended, so recalc doesn't fire between syncs.
} finally {
  context.application.calculationMode = saved;
  await context.sync();
}
```

## When you need it

- 3-statement models (IS / BS / CF cross-references)
- LBO models
- Apartment / office / industrial development models
- Waterfalls with promote feeding back into IRR (requires iterative calc too — see below)
- Any multi-sheet build that exceeds ~50 formula writes

## When you don't

- Single-cell writes
- Writing a static block of literal values
- Writing one formula in isolation

## Iterative calc (for circular references)

Waterfalls where promote affects IRR (which affects which tier triggers) need iterative calc enabled at the workbook level. The Office.js path:

```js
const calc = context.workbook.calculationSettings;
calc.iterativeCalculation.enabled = true;
calc.iterativeCalculation.maxIteration = 100;
calc.iterativeCalculation.maxChange = 0.001;
await context.sync();
```

This is a workbook-level setting — it persists with the file. Set it before writing the circular formulas; reset it (or leave on) after.

## Verifying calc mode after restoration

If the workbook has user-defined calc settings, restoration via the saved value works fine. But on first runs against a brand-new workbook, the saved value may be `"automatic"` literally, which is the default. Either way, restoring is the safe thing.

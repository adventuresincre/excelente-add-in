# CRE audit cells

A model without audit cells is a model you can't trust. Build them in from the start, not bolted on at the end. Each audit cell is a formula that should always evaluate to 0 (or another known constant). Non-zero = the model is broken.

## The standard four

Every institutional-quality model should include these. Put them on a `Returns` or `Summary` sheet, in a labeled "Audit" block:

### 1. Sources – Uses = 0

```
=SUM(Sources) - SUM(Uses)
```

When non-zero: total funding doesn't equal total project cost. The equity plug is wrong, or a cost line is missing/double-counted.

### 2. Assets – Liabilities – Equity = 0

```
=SUM(Assets) - SUM(Liabilities) - SUM(Equity)
```

Standard balance sheet identity. Non-zero = an entry is on the wrong side or missing.

### 3. Σ(waterfall distributions) – Total distributable cash = 0

```
=SUM(All waterfall tier distributions across all periods) - SUM(Distributable cash flows from operations + sale)
```

Non-zero = the waterfall doesn't sum back. Cash is being created or destroyed in the tier logic.

### 4. LP unreturned capital at exit = 0

```
=Beginning LP capital - SUM(LP return-of-capital distributions over hold)
```

When the pref tier is correct, all LP capital comes back before any promote splits. Non-zero = either the model isn't returning LP capital first, or the model is treating distributions out of order.

## Stress-test cells

In addition to the always-zero audits, add degenerate-case test cells the user can flip to validate behavior:

- **Promote = 0% sanity:** "If promote were zero, LP would receive 100% of cash above return-of-capital." Confirm by setting promote to zero (temporarily) and reading the LP IRR.
- **Zero rent growth sanity:** project IRR collapses to a known floor.
- **Exit cap = Entry cap sanity:** trended yield should equal untrended yield.

These don't need to be cells — they're mental checks the agent (and reviewer) should run after the build.

## How to format audit cells

A.CRE convention:

- Audit cells in a separate labeled block titled "Model Audit" or "Integrity Checks"
- Each labeled clearly ("Sources – Uses (should be 0)")
- Conditional formatting: green/checkmark when |value| < 1, red/X when ≥ 1
- Bold the label so reviewers find them fast

## When to read them back

After every non-trivial write (e.g., after the last `update_plan_step` lands "done"), read these cells:

```
inspect_workbook({
  scope: "range",
  sheetName: "Returns",
  address: "B40:B45",  // wherever the audit cells live
})
```

If any are non-zero, the build isn't done. Fix before declaring complete.

# Waterfall footguns

The five silent failures that pass "no error values" but are structurally broken. None of them throw `#REF!` or `#VALUE!`. All of them produce plausible-looking IRRs that are wrong. Watch for these specifically when building or reviewing a waterfall.

## 1. Promote applied to gross cash flow instead of net distributable

**Wrong:** GP promote split applied to the period's total cash flow, including the LP's own returning capital.

**Right:** Promote splits apply only to cash ABOVE return-of-capital + pref. Return-of-capital is 100% LP (or 100% partner-pro-rata, depending on structure); pref is 100% LP at the pref rate; everything above pref is where promote kicks in.

**Detection:** Set promote to zero temporarily. LP should receive 100% of cash above return-of-capital. If GP is getting any of that, the bucket is wrong.

## 2. Catch-up bucket fed by the wrong source

**Wrong:** GP catch-up bucket pulling from pref distributions, or from return-of-capital.

**Right:** GP catch-up comes out of the NEXT DOLLAR ABOVE PREF — not the pref itself, not the LP's capital. Check by tracing: cash flows into the waterfall → first pay LP capital back (RoC) → then LP pref (compound or simple, depending on structure) → then GP catch-up at a specified split until GP "catches up" to a target proportion of profits → then everything above splits per the promote rates at each IRR hurdle.

**Detection:** Audit cell that sums the catch-up bucket's source feed across periods should equal the catch-up bucket's recipient feed (within rounding). If catch-up source includes pref dollars, the sum is too large.

## 3. IRR hurdle measured at project level vs LP level

**Wrong:** Tier breaks triggered by project IRR (the unlevered or all-in IRR of the deal as a whole).

**Right:** Tier breaks trigger by LP IRR — what the LP actually received, including all distributions and capital contributions. The LP doesn't care about project IRR; they care about what hits their bank account.

**Detection:** Compute IRR independently using only LP cash flows (capital out → distributions in → exit). If a tier triggers at "8% project IRR" instead of "8% LP IRR," tier splits will be wrong for any deal where leverage changes the relationship between project- and LP-level returns.

## 4. Off-by-one period error in compounded accrual

**Wrong:** Pref accrued in period N applied AFTER period N's distribution. Or BEFORE, depending on convention — the point is inconsistency.

**Right:** Pick a convention (typically: accrue at the START of the period, distribute at the END) and apply it identically every period. The convention matters less than the consistency. A 10-year hold with a one-period mistake compounds badly.

**Detection:** For a degenerate case (no distributions until exit), the ending pref balance should equal `Beginning capital × (1 + pref)^(years held) - Beginning capital`. If it's off by `(1 + pref)`, you accrued an extra period (or missed one).

## 5. Stale references after revisions

**Wrong:** User changes hard costs from $80M to $84M; loan sizing still references the old total cost cell that's now disconnected. Equity plug silently absorbs the difference.

**Right:** Every input that flows downstream should be referenced via formula, not pasted. After any revision, re-tie sources & uses. The sources – uses audit cell catches this immediately if you read it back.

**Detection:** The standard `Sources – Uses = 0` audit cell. Read it after revisions, not just at initial build.

## Reviewer checklist

When reviewing a waterfall (Reviewer subagent), explicitly check each:

- [ ] Set promote to zero in your head: does LP get 100% above RoC? (#1)
- [ ] Trace catch-up source: does it come from above-pref dollars only? (#2)
- [ ] Confirm IRR hurdles measured at LP level, not project level. (#3)
- [ ] For a no-distribution-until-exit scenario, does ending pref balance match `BeginCap × (1+pref)^n - BeginCap`? (#4)
- [ ] Sources – Uses audit cell = 0? (#5)

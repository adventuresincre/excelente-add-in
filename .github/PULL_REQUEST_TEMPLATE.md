<!--
Thanks for the contribution. Two things make review fast: a focused diff and a
real test plan. See CONTRIBUTING.md.
-->

## What this changes

<!-- One or two sentences. If it fixes an issue, write "Fixes #123". -->

## Why

<!-- What was broken or missing. If there is an issue with the discussion, link it. -->

## Test plan

<!--
Tell us what you did in Excel, not just that tests pass. Include the host, the
model, and what the workbook looked like. Example:

Excel 365 Windows 16.0.18227, model anthropic/claude-sonnet-5. Built a 10-year
DCF on a blank sheet, asked for a two-way sensitivity table on exit cap and
rent growth. Before: wrote into B2 and clobbered the header row. After: writes
into B14. Also checked margin=0, which still produces an exact crop.

If you could not test in a real host, say so. That is fine and we will test it.
-->

## Gates

- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] `npm run lint` passes
- [ ] `npm run build` passes
- [ ] `npm run validate` passes (only if you touched `manifest.template.xml`)

## Checklist

- [ ] The diff is scoped to one thing
- [ ] I updated the relevant `core/*/README.md` if I changed a module's interface
- [ ] I read the diff myself, including anything an agent wrote
- [ ] New behavior has a test, or I explained why it cannot

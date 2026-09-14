# The sweep pattern — source rows to a clean table, without touching your context

Property-management exports (RealPage, Yardi, Entrata, AppFolio, ResMan,
OneSite) rarely give you one row per unit. A unit is a **block**: a header row
carrying unit / SF / status / tenant / lease dates, followed by a variable
number of charge-code rows that must be aggregated.

Parsing that by reading it into the conversation does not scale — 134 units is
already enough to exhaust a run. Parse it in the workbook.

## Step 1 — learn the shape (cheap, and the only part you read)

Inspect the header area and **two** representative blocks: one ordinary, one
awkward (a vacant unit, or one with extra charge codes).

```
inspect_workbook(scope="range", address="Avenue 19!A1:V16")
inspect_workbook(scope="range", address="Avenue 19!A553:V599")
```

You are answering four questions, nothing more:

1. What marks the start of a block? (a non-empty unit id in column A)
2. Which columns hold the unit-level fields?
3. Which rows are charge lines, and where is the code and the amount?
4. Which charge codes are recurring rent vs one-time (deposits, application
   fees, administration fees)?

Write those answers down as the rules your script will apply. Stop reading.

## Step 2 — sweep in one script

```js
const SRC = "Avenue 19";
const OUT = "Rent Roll";

// Charge codes that are NOT recurring monthly income. Excluding them is a
// judgment call, so it belongs in one visible list, not scattered in prose.
const ONE_TIME = new Set(["Other Deposit", "Application Fee", "SR Administration Fee"]);

const src = ctx.workbook.worksheets.getItem(SRC);
const used = src.getUsedRange();
used.load("values");
await ctx.sync();

const v = used.values;
const rows = [];
let cur = null;

const flush = () => {
  if (!cur) return;
  rows.push([
    cur.unit, cur.type, cur.sf, cur.status, cur.tenant,
    cur.moveIn, cur.leaseStart, cur.leaseEnd,
    cur.rent, cur.other, cur.market,
  ]);
  cur = null;
};

for (const r of v) {
  const unitId = String(r[0] ?? "").trim();
  const isBlockStart = /^[A-Z]\d{2}$/.test(unitId);   // learned in step 1

  if (isBlockStart) {
    flush();
    cur = {
      unit: unitId, type: r[1], sf: r[2], status: r[3], tenant: r[4],
      moveIn: r[5], leaseStart: r[6], leaseEnd: r[7],
      rent: 0, other: 0, market: r[12],
    };
    continue;
  }
  if (!cur) continue;                                  // pre-header noise

  const code = String(r[8] ?? "").trim();              // charge-code column
  const amt = Number(r[12]) || 0;
  if (!code) continue;
  if (code === "Rent") cur.rent += amt;
  else if (!ONE_TIME.has(code)) cur.other += amt;
}
flush();

const out = ctx.workbook.worksheets.getItem(OUT);
out.getRangeByIndexes(2, 0, rows.length, rows[0].length).values = rows;
await ctx.sync();

// Proof the write landed, and the numbers you need to cross-foot against.
return {
  unitsWritten: rows.length,
  totalScheduledRent: rows.reduce((s, r) => s + (Number(r[8]) || 0), 0),
  vacant: rows.filter((r) => /vacant/i.test(String(r[3]))).length,
};
```

## Step 3 — cross-foot before you build anything on top

The source almost always prints its own totals. Compare:

- `unitsWritten` against the stated unit count.
- `totalScheduledRent` against the export's rent total.

A variance is a **finding**, not a defect to paper over: report it, say which
side you trust, and move on. Never adjust your parse to force a tie.

## Step 4 — dates

Carry lease dates through as **serial numbers** and apply a date number format
with `format_range` (`"yyyy-mm-dd"` or `"m/d/yyyy"`). Do not convert serials to
strings, and never compute the calendar date by hand — Excel already knows.

When you need a date threshold in a formula, write it as a formula:
`=COUNTIFS(H:H, ">=" & DATE(2025,4,1), H:H, "<" & DATE(2025,7,1))`.

## What this pattern buys you

| | Read-into-context | Sweep in workbook |
|---|---|---|
| Tokens for 134 units | ~4M cache reads | a few thousand |
| Charge-code math | by hand, per unit | one visible rule |
| Re-running on a 500-unit roll | infeasible | same script |
| Auditability | prose in a transcript | a script the user can read |

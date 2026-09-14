import { describe, expect, it } from "vitest";
import { inMemoryDataSource, type InMemoryWorkbook } from "../../context";
import { createUndoStack } from "../undo";
import { createSheetTool, formatRangeTool, undoTool, writeRangeTool } from "./write";

function makeDs(): InMemoryWorkbook {
  return {
    sheets: [
      {
        name: "Sheet1",
        cells: {
          A1: { value: 10 },
          A2: { value: 20 },
          A3: { value: 30 },
        },
      },
    ],
  };
}

describe("write_range tool", () => {
  it("writes a column of literal values", async () => {
    const wb = makeDs();
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    const result = await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "B1:B3", formulas: [["100"], ["200"], ["300"]] },
      { ds, undoStack }
    );

    expect(result.rowCount).toBe(3);
    expect(result.columnCount).toBe(1);
    expect(wb.sheets[0].cells?.B1?.value).toBe(100);
    expect(wb.sheets[0].cells?.B2?.value).toBe(200);
    expect(wb.sheets[0].cells?.B3?.value).toBe(300);
    expect(undoStack.size()).toBe(1);
  });

  it("writes formulas (strings starting with =)", async () => {
    const wb = makeDs();
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "B1:B3",
        formulas: [["=A1*2"], ["=A2*2"], ["=A3*2"]],
      },
      { ds, undoStack }
    );

    expect(wb.sheets[0].cells?.B1?.formula).toBe("=A1*2");
    expect(wb.sheets[0].cells?.B3?.formula).toBe("=A3*2");
  });

  // ANCHOR SEMANTICS (2026-09-04). `address` fixes the top-left cell; the
  // grid fixes the extent. Requiring them to agree cost 13 refused calls in
  // one observed session, every one of them on a grid that was already right.
  it("treats a bare anchor cell as the top-left of whatever grid is sent", async () => {
    const wb = makeDs();
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    const result = await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "B2",
        formulas: [
          ["a", "b", "c"],
          ["d", "e", "f"],
        ],
      },
      { ds, undoStack }
    );

    expect(result.written).toBe("Sheet1!B2:D3");
    expect(result.rowCount).toBe(2);
    expect(result.columnCount).toBe(3);
    expect(wb.sheets[0].cells?.B2?.value).toBe("a");
    expect(wb.sheets[0].cells?.D3?.value).toBe("f");
  });

  it("resizes a declared range to the grid and says so, instead of refusing", async () => {
    const wb = makeDs();
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    // The exact off-by-one that failed live: 9-row address, 10-row grid.
    const grid = Array.from({ length: 10 }, (_, r) => [`r${r}`, "x"]);
    const result = await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "A1:B9", formulas: grid },
      { ds, undoStack }
    );

    expect(result.written).toBe("Sheet1!A1:B10");
    expect(result.rowCount).toBe(10);
    expect(result.note).toMatch(/declared 9×2 but the grid is 10×2/);
    expect(result.note).toMatch(/anchor cell/);
    expect(wb.sheets[0].cells?.A10?.value).toBe("r9");
  });

  it("resizes when fewer rows are sent than the address declared", async () => {
    const wb = makeDs();
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    const result = await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "A1:B5",
        formulas: [
          ["a", "b"],
          ["c", "d"],
          ["e", "f"],
        ],
      },
      { ds, undoStack }
    );

    expect(result.written).toBe("Sheet1!A1:B3");
    expect(result.note).toMatch(/declared 5×2 but the grid is 3×2/);
  });

  it("keeps the sheet qualifier when resizing a qualified address", async () => {
    const ds = inMemoryDataSource(makeDs());
    const undoStack = createUndoStack();

    const result = await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "Sheet1!A1:B5",
        formulas: [
          ["a", "b"],
          ["c", "d"],
          ["e", "f"],
        ],
      },
      { ds, undoStack }
    );

    expect(result.note).toMatch(/wrote Sheet1!A1:B3/);
  });

  it("normalizes $-absolute anchors", async () => {
    const ds = inMemoryDataSource(makeDs());
    const undoStack = createUndoStack();

    const result = await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "$A$1:$B$5",
        formulas: [
          ["a", "b"],
          ["c", "d"],
        ],
      },
      { ds, undoStack }
    );

    expect(result.written).toBe("Sheet1!A1:B2");
  });

  it("still refuses a ragged grid — that is a real authoring mistake", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    let captured = "";
    try {
      await writeRangeTool.execute(
        {
          sheetName: "Sheet1",
          address: "A1",
          formulas: [
            ["x", "y"],
            ["a", "b", "c"],
          ],
        },
        { ds, undoStack }
      );
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toMatch(/different lengths/);
    expect(captured).toContain("row 0: 2; row 1: 3");
    expect(captured).toContain("Nothing was written");
  });

  it("ragged grid: names the width the model meant, never blames the anchor", async () => {
    // 2026-09-10: the old wording said "address C3:I7 requires exactly 6
    // cells" because row 0 happened to have 6; C:I is seven columns.
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    const six = ["a", "b", "c", "d", "e", "f"];
    const seven = [...six, "g"];
    await expect(
      writeRangeTool.execute(
        { sheetName: "Sheet1", address: "C3:I7", formulas: [six, six, six, six, seven] },
        { ds, undoStack }
      )
    ).rejects.toThrow(
      /rows 0–3: 6; row 4: 7.*Address C3:I7 spans 7 columns, so make every row 7 cells: pad the 6-cell rows with 1 × ""/
    );

    // Bare anchor: no declared width, so the commonest length wins.
    const eight = [...seven, "h"];
    await expect(
      writeRangeTool.execute(
        { sheetName: "Sheet1", address: "B2", formulas: [six.slice(0, 5), eight, eight, eight] },
        { ds, undoStack }
      )
    ).rejects.toThrow(
      /Most rows have 8, so make every row 8 cells: pad the 5-cell rows with 3 × ""/
    );
  });

  it("still refuses an empty grid", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    await expect(
      writeRangeTool.execute(
        { sheetName: "Sheet1", address: "A1:C2", formulas: [] },
        { ds, undoStack }
      )
    ).rejects.toThrow(/no usable cell grid|grid is empty/);
  });

  it("flags a transposed input shape explicitly", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    // A1:K18 = 18 rows × 11 cols. Transposed input is 11 rows × 18 cols.
    const transposed = Array.from({ length: 11 }, () => Array.from({ length: 18 }, () => "x"));
    await expect(
      writeRangeTool.execute(
        { sheetName: "Sheet1", address: "A1:K18", formulas: transposed },
        { ds, undoStack }
      )
    ).rejects.toThrow(/TRANSPOSED/);
  });

  it("snapshots the prior contents for undo", async () => {
    const wb: InMemoryWorkbook = {
      sheets: [
        {
          name: "Sheet1",
          cells: {
            B1: { value: 100, formula: "=A1" },
            B2: { value: 200 },
          },
        },
      ],
    };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "B1:B2", formulas: [["new1"], ["new2"]] },
      { ds, undoStack }
    );

    const entry = undoStack.peek();
    expect(entry?.priorFormulas).toEqual([["=A1"], [""]]);
    expect(entry?.priorValues).toEqual([[100], [200]]);
  });

  it("copy_to_range fills the pattern across a larger range (in-memory: tile)", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "S" }] });
    const undoStack = createUndoStack();
    const result = await writeRangeTool.execute(
      {
        sheetName: "S",
        address: "A1",
        formulas: [["=B1*2"]],
        copy_to_range: "A1:A5",
      },
      { ds, undoStack }
    );
    expect(result.filled).toBe("S!A1:A5");
    // In-memory tiles the seed across the target.
    const after = await ds.getRange("S", "A1:A5");
    expect(after.formulas).toEqual([["=B1*2"], ["=B1*2"], ["=B1*2"], ["=B1*2"], ["=B1*2"]]);
  });

  it("copy_to_range rejects ranges that don't share a starting cell", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "S" }] });
    await expect(
      writeRangeTool.execute(
        { sheetName: "S", address: "A1", formulas: [["x"]], copy_to_range: "B1:B5" },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/share starting cell/);
  });

  it("copy_to_range rejects targets smaller than the seed", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "S" }] });
    await expect(
      writeRangeTool.execute(
        {
          sheetName: "S",
          address: "A1:A5",
          formulas: [["a"], ["b"], ["c"], ["d"], ["e"]],
          copy_to_range: "A1:A3",
        },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/strictly contain/);
  });

  it("confirm_overwrite=true refuses to clobber non-empty cells", async () => {
    const ds = inMemoryDataSource({
      sheets: [{ name: "S", cells: { A1: { value: 99 } } }],
    });
    await expect(
      writeRangeTool.execute(
        { sheetName: "S", address: "A1", formulas: [["new"]], confirm_overwrite: true },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/non-empty cell/);
  });

  it("confirm_overwrite=true allows writes into empty cells", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "S" }] });
    const result = await writeRangeTool.execute(
      { sheetName: "S", address: "A1", formulas: [["hello"]], confirm_overwrite: true },
      { ds, undoStack: createUndoStack() }
    );
    expect(result.written).toBe("S!A1");
  });
});

describe("write_range input normalization (grids models actually send)", () => {
  // Observed live 2026-07-02: a model looped an identical failing call
  // because every malformed-grid variant collapsed into one misleading
  // "empty formulas array" error. These cases lock in the forgiving path.
  function freshCtx() {
    return { ds: inMemoryDataSource({ sheets: [{ name: "S" }] }), undoStack: createUndoStack() };
  }

  it("accepts the grid under `values` (alias) and notes the canonical key", async () => {
    const ctx = freshCtx();
    const result = await writeRangeTool.execute(
      { sheetName: "S", address: "B1:B2", values: [["1"], ["2"]] } as never,
      ctx
    );
    expect(result.written).toBe("S!B1:B2");
    expect(result.note).toMatch(/canonical parameter is `formulas`/);
  });

  it("auto-decodes a JSON-encoded string grid and notes it", async () => {
    const ctx = freshCtx();
    const result = await writeRangeTool.execute(
      { sheetName: "S", address: "A1:C1", formulas: '[["a", "b", "c"]]' as never },
      ctx
    );
    expect(result.written).toBe("S!A1:C1");
    expect(result.note).toMatch(/JSON-encoded string/);
  });

  it("wraps a flat 1D array for a single-row range", async () => {
    const ctx = freshCtx();
    const result = await writeRangeTool.execute(
      // The exact live failure: 1×10 range, grid arrived flat.
      {
        sheetName: "S",
        address: "B2:K2",
        formulas: ["", "h1", "h2", "h3", "h4", "h5", "h6", "h7", "h8", ""] as never,
      },
      ctx
    );
    expect(result.rowCount).toBe(1);
    expect(result.columnCount).toBe(10);
    expect(result.note).toMatch(/wrapped as one row/);
  });

  it("reshapes a flat 1D array for a single-column range", async () => {
    const ctx = freshCtx();
    const result = await writeRangeTool.execute(
      { sheetName: "S", address: "A1:A3", formulas: ["x", "y", "z"] as never },
      ctx
    );
    expect(result.rowCount).toBe(3);
    expect(result.columnCount).toBe(1);
    expect(result.note).toMatch(/one column/);
  });

  it("does NOT guess for an ambiguous 1D array into a 2D range", async () => {
    const ctx = freshCtx();
    await expect(
      writeRangeTool.execute(
        { sheetName: "S", address: "A1:B2", formulas: ["a", "b", "c", "d"] as never },
        ctx
      )
    ).rejects.toThrow(/entries could not be read as rows/);
  });

  it("missing grid: error names the received keys and says `formulas` was absent", async () => {
    const ctx = freshCtx();
    await expect(
      writeRangeTool.execute({ sheetName: "S", address: "B2:K2" } as never, ctx)
    ).rejects.toThrow(/Keys received: \[sheetName, address\].*`formulas` was ABSENT/s);
  });

  it("empty-array grid: error says the array was EMPTY, not just 'wrong shape'", async () => {
    const ctx = freshCtx();
    await expect(
      writeRangeTool.execute({ sheetName: "S", address: "B2:K2", formulas: [] }, ctx)
    ).rejects.toThrow(/EMPTY array \[\]/);
  });

  it("unparseable string grid: error says it arrived as a string", async () => {
    const ctx = freshCtx();
    await expect(
      writeRangeTool.execute(
        { sheetName: "S", address: "A1", formulas: "not an array" as never },
        ctx
      )
    ).rejects.toThrow(/arrived as a string \(not a JSON array\)/);
  });
});

describe("write_range: formulas Excel would reject", () => {
  const OFFICE_INVALID = "The argument is invalid or missing or has an incorrect format.";

  /** In-memory data source whose setRange refuses any grid containing a cell matching `bad`. */
  function rejectingDs(wb: InMemoryWorkbook, bad: (cell: string) => boolean) {
    const inner = inMemoryDataSource(wb);
    const calls: string[] = [];
    const ds = {
      ...inner,
      async setRange(sheetName: string, address: string, grid: string[][]) {
        calls.push(address);
        if (grid.some((row) => row.some((cell) => bad(cell)))) {
          const e = new Error(OFFICE_INVALID) as Error & { code: string };
          e.code = "InvalidArgument";
          throw e;
        }
        return inner.setRange(sheetName, address, grid);
      },
    };
    return { ds, calls };
  }

  it("refuses a formula carrying a redaction placeholder, names the cell, and explains the source", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();
    let captured = "";
    try {
      await writeRangeTool.execute(
        {
          sheetName: "Sheet1",
          address: "B8",
          formulas: [["Total", "=SUM(C4:C7)", "1", '=IF(C8=0,"-",F8/C8)', "=[PERSON_NAME]:F7)"]],
        },
        { ds, undoStack }
      );
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toContain("F8 contains [PERSON_NAME]");
    expect(captured).toContain('"=[PERSON_NAME]:F7)"');
    expect(captured).toMatch(/privacy filter/);
    expect(captured).toMatch(/Never copy cell text from earlier/);
    expect(captured).toContain("Nothing was written");
    expect(wb.sheets[0].cells ?? {}).toEqual({});
    expect(undoStack.size()).toBe(0);
  });

  it("refuses an unbalanced formula before asking Excel", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await expect(
      writeRangeTool.execute(
        { sheetName: "Sheet1", address: "F8", formulas: [["=SUM(F4:F7"]] },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/F8 has 1 unclosed '\('/);
  });

  it("writes literal placeholders but notes them", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);
    const result = await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "B3", formulas: [["Unit Type", "Total [ADDRESS]"]] },
      { ds, undoStack: createUndoStack() }
    );
    expect(wb.sheets[0].cells?.C3?.value).toBe("Total [ADDRESS]");
    expect(result.note).toMatch(/Literal text in C3 contains a redaction placeholder/);
  });

  it("isolates the cells Excel rejected, writes the rest, and says so", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    // Excel-only failures: syntactically balanced, so the client pre-check passes.
    const { ds } = rejectingDs(wb, (cell) => cell === "=B7D7(" + ")" || cell === "=1+");
    const grid = [
      ["Studio", "40", "=C4/$C$8", "=B7D7()"],
      ["1BR", "50", "=C5/$C$8", "=E5*C5"],
      ["2BR", "30", "=C6/$C$8", "=1+"],
      ["Total", "=SUM(C4:C6)", "1", "=SUM(E4:E6)"],
    ];
    let captured = "";
    try {
      await writeRangeTool.execute(
        { sheetName: "Sheet1", address: "B4", formulas: grid },
        { ds, undoStack: createUndoStack() }
      );
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toMatch(/partially failed on Sheet1!B4:E7/);
    expect(captured).toContain('E4 = "=B7D7()"');
    expect(captured).toContain('E6 = "=1+"');
    expect(captured).toContain("The other 14 cells were written; resend only the listed cells");
    // The good cells really are on the sheet; the bad ones are not.
    const cells = wb.sheets[0].cells ?? {};
    expect(cells.B4?.value).toBe("Studio");
    expect(cells.E5?.formula).toBe("=E5*C5");
    expect(cells.D7?.value).toBe(1);
    expect(cells.E4).toBeUndefined();
    expect(cells.E6).toBeUndefined();
  });

  it("bisects rather than probing cell by cell on a large grid", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const { ds, calls } = rejectingDs(wb, (cell) => cell === "=1+");
    const grid = Array.from({ length: 128 }, (_, r) => [
      `Unit ${r + 1}`,
      "=A1",
      r === 100 ? "=1+" : "=B1",
      "x",
    ]);
    let captured = "";
    try {
      await writeRangeTool.execute(
        { sheetName: "Sheet1", address: "A1", formulas: grid },
        { ds, undoStack: createUndoStack() }
      );
    } catch (e) {
      captured = (e as Error).message;
    }
    expect(captured).toContain('C101 = "=1+"');
    expect(captured).toContain("The other 511 cells were written");
    // 512 cells, one bad: roughly 2·log2(512) probes, never 512.
    expect(calls.length).toBeLessThan(30);
    expect(wb.sheets[0].cells?.A128?.value).toBe("Unit 128");
    expect(wb.sheets[0].cells?.C101).toBeUndefined();
  });

  it("passes other data-source failures through with the range attached", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await expect(
      writeRangeTool.execute(
        { sheetName: "Missing", address: "A1", formulas: [["x"]] },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/Sheet not found/);
  });

  it("reports what landed on which row", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const result = await writeRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "B2",
        formulas: [
          ["Unit Mix", "", "", "", "", "", "", ""],
          ["Unit Type", "Units", "% of Units", "Avg SF/Unit", "Total SF", "Rent", "PSF", "Revenue"],
          ["Studio", "", "=C4/$C$8", "", "=C4*E4", "", "=G4/E4", "=C4*G4"],
          ["Total", "=SUM(C4:C4)", "1", "=F8/C8", "=SUM(F4:F4)", "=I8/C8", "=I8/F8", "=SUM(I4:I4)"],
        ],
      },
      { ds, undoStack: createUndoStack() }
    );
    expect(result.written).toBe("Sheet1!B2:I5");
    expect(result.layout).toEqual([
      'row 2: Unit Mix | "" | "" | "" | +4 more',
      "row 3: Unit Type | Units | % of Units | Avg SF/Unit | +4 more",
      'row 4: Studio | "" | =C4/$C$8 | "" | +4 more',
      "row 5: Total | =SUM(C4:C4) | 1 | =F8/C8 | +4 more",
    ]);
  });

  it("omits the layout for a single row and caps it for a long table", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const one = await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "A1", formulas: [["a", "b", "c"]] },
      { ds, undoStack: createUndoStack() }
    );
    expect(one.layout).toBeUndefined();

    const rows = Array.from({ length: 200 }, (_, i) => [`Unit ${i + 1}`, String(i)]);
    const many = await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "A1", formulas: rows },
      { ds, undoStack: createUndoStack() }
    );
    expect(many.layout).toHaveLength(10);
    expect(many.layout?.[0]).toBe("row 1: Unit 1 | 0");
    expect(many.layout?.[7]).toBe("… 191 more rows …");
    expect(many.layout?.[9]).toBe("row 200: Unit 200 | 199");
  });
});

describe("undo tool", () => {
  it("restores the most recent write", async () => {
    const wb: InMemoryWorkbook = {
      sheets: [{ name: "Sheet1", cells: { B1: { value: 999 } } }],
    };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "B1", formulas: [["100"]] },
      { ds, undoStack }
    );
    expect(wb.sheets[0].cells?.B1?.value).toBe(100);

    const result = await undoTool.execute({}, { ds, undoStack });
    expect(result.restored).toBe("Sheet1!B1");
    // After undo, the in-memory backend re-wrote a literal "999" (no formula).
    expect(wb.sheets[0].cells?.B1?.value).toBe(999);
    expect(undoStack.size()).toBe(0);
  });

  it("returns a helpful message when nothing is on the stack", async () => {
    const ds = inMemoryDataSource(makeDs());
    const undoStack = createUndoStack();
    const result = await undoTool.execute({}, { ds, undoStack });
    expect(result.message).toBe("Nothing to undo.");
  });

  it("multiple writes then multiple undos restore in reverse order", async () => {
    const wb: InMemoryWorkbook = {
      sheets: [{ name: "Sheet1", cells: { A1: { value: 1 }, A2: { value: 2 } } }],
    };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "A1", formulas: [["100"]] },
      { ds, undoStack }
    );
    await writeRangeTool.execute(
      { sheetName: "Sheet1", address: "A2", formulas: [["200"]] },
      { ds, undoStack }
    );
    expect(wb.sheets[0].cells?.A1?.value).toBe(100);
    expect(wb.sheets[0].cells?.A2?.value).toBe(200);

    await undoTool.execute({}, { ds, undoStack });
    expect(wb.sheets[0].cells?.A2?.value).toBe(2);
    expect(wb.sheets[0].cells?.A1?.value).toBe(100); // not yet restored

    await undoTool.execute({}, { ds, undoStack });
    expect(wb.sheets[0].cells?.A1?.value).toBe(1);
  });
});

describe("format_range tool", () => {
  it("forwards format properties to ds.setFormat", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    const result = await formatRangeTool.execute(
      {
        sheetName: "Sheet1",
        address: "A1:H9",
        numberFormat: "$#,##0",
        bold: true,
        fillColor: "#1F4E79",
        fontColor: "#FFFFFF",
        horizontalAlignment: "center",
      },
      { ds, undoStack }
    );

    expect(result.formatted).toBe("Sheet1!A1:H9");
    expect(result.applied).toEqual([
      "numberFormat=$#,##0",
      "bold=true",
      "fontColor=#FFFFFF",
      "fillColor=#1F4E79",
      "hAlign=center",
    ]);

    const applied = wb.sheets[0].appliedFormats ?? [];
    expect(applied).toHaveLength(1);
    expect(applied[0]).toEqual({
      address: "A1:H9",
      format: {
        numberFormat: "$#,##0",
        bold: true,
        fillColor: "#1F4E79",
        fontColor: "#FFFFFF",
        horizontalAlignment: "center",
      },
    });
  });

  it("only forwards properties that were provided (no spurious undefineds)", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);

    await formatRangeTool.execute(
      { sheetName: "Sheet1", address: "B5", bold: true },
      { ds, undoStack: createUndoStack() }
    );

    const applied = wb.sheets[0].appliedFormats ?? [];
    expect(applied[0].format).toEqual({ bold: true });
  });

  it("does not push to the undo stack (format changes use Excel's native undo)", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    await formatRangeTool.execute(
      { sheetName: "Sheet1", address: "A1", bold: true },
      { ds, undoStack }
    );
    expect(undoStack.size()).toBe(0);
  });

  it("is marked as a write tool (routes through approval gate)", () => {
    expect(formatRangeTool.requiredPermission).toBe("Write");
  });

  it("throws for unknown sheet", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    await expect(
      formatRangeTool.execute(
        { sheetName: "Missing", address: "A1", bold: true },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(/Sheet not found/);
  });

  it("attaches the address and the properties sent to a host failure", async () => {
    const inner = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const ds = {
      ...inner,
      async setFormat() {
        throw new Error("The argument is invalid or missing or has an incorrect format.");
      },
    };
    await expect(
      formatRangeTool.execute(
        { sheetName: "Sheet1", address: "B8:I8", numberFormat: "$#,##0;($#,##0);-", bold: true },
        { ds, undoStack: createUndoStack() }
      )
    ).rejects.toThrow(
      /format_range failed on Sheet1!B8:I8 \(numberFormat="\$#,##0;\(\$#,##0\);-", bold=true\): The argument is invalid.*numberFormat is a valid Excel format string/
    );
  });
});

describe("create_sheet tool", () => {
  it("creates a sheet and returns its resolved name", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);

    const result = await createSheetTool.execute(
      { name: "RR Analysis" },
      { ds, undoStack: createUndoStack() }
    );

    expect(result.sheetName).toBe("RR Analysis");
    expect(result.note).toBeUndefined();
    expect(wb.sheets.map((s) => s.name)).toContain("RR Analysis");
  });

  it("suffixes instead of failing when the name is taken, and says so", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Sheet1" }, { name: "RR Analysis" }] };
    const ds = inMemoryDataSource(wb);

    const result = await createSheetTool.execute(
      { name: "RR Analysis" },
      { ds, undoStack: createUndoStack() }
    );

    expect(result.sheetName).toBe("RR Analysis (2)");
    expect(result.note).toMatch(/already taken/);
    expect(wb.sheets).toHaveLength(3);
  });

  it("honors an explicit tab position", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "A" }, { name: "B" }] };
    const ds = inMemoryDataSource(wb);

    await createSheetTool.execute(
      { name: "First", position: 0 },
      { ds, undoStack: createUndoStack() }
    );

    expect(wb.sheets.map((s) => s.name)).toEqual(["First", "A", "B"]);
  });

  it("requires Write permission — sheet creation is a workbook mutation", () => {
    expect(createSheetTool.requiredPermission).toBe("Write");
  });

  // The gap that mattered: a build must be able to make its own tab without
  // reaching for run_excel_script (2026-09-04).
  it("gives the agent a named tab without touching run_excel_script", async () => {
    const wb: InMemoryWorkbook = { sheets: [{ name: "Avenue 19" }, { name: "Sheet1" }] };
    const ds = inMemoryDataSource(wb);
    const undoStack = createUndoStack();

    const { sheetName } = await createSheetTool.execute({ name: "Unit Mix" }, { ds, undoStack });
    const write = await writeRangeTool.execute(
      {
        sheetName,
        address: "A1",
        formulas: [
          ["Unit", "SF"],
          ["A01", "702"],
        ],
      },
      { ds, undoStack }
    );

    expect(write.written).toBe("Unit Mix!A1:B2");
  });
});

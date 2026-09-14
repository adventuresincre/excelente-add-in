import { describe, expect, it } from "vitest";
import { normalizeFormula } from "./formula-norm";
import { parseA1 } from "./address";

function norm(formula: string, originA1: string): string {
  return normalizeFormula(formula, parseA1(originA1));
}

describe("normalizeFormula", () => {
  it("preserves function names and operators", () => {
    expect(norm("=SUM(1, 2)", "A1")).toBe("=SUM(1, 2)");
    expect(norm("=IF(TRUE, 1, 0)", "A1")).toBe("=IF(TRUE, 1, 0)");
  });

  it("normalizes relative refs to offsets from origin", () => {
    // Output format is column-then-row to mirror A1's letters-then-digits.
    expect(norm("=B2", "B5")).toBe("=C+0R-3");
    expect(norm("=A1", "C3")).toBe("=C-2R-2");
    expect(norm("=B5", "B5")).toBe("=C+0R+0");
  });

  it("clusters identical relative-fill formulas", () => {
    // Same formula filled down: SUM of preceding 3 rows in same column
    const a = norm("=SUM(B2:B4)", "B5");
    const b = norm("=SUM(B3:B5)", "B6");
    const c = norm("=SUM(B10:B12)", "B13");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("does NOT cluster formulas whose ref shape differs", () => {
    // SUM(B2:B4) in B5 vs SUM(C2:C4) in B6 -- second cell's range is in
    // a different column, so the relative offset to the col differs.
    const a = norm("=SUM(B2:B4)", "B5");
    const b = norm("=SUM(C2:C4)", "B6");
    expect(a).not.toBe(b);
  });

  it("keeps absolute parts as literals", () => {
    expect(norm("=$A$1", "B5")).toBe("=$A$1");
    expect(norm("=$A1", "B5")).toBe("=$AR-4");
    expect(norm("=A$1", "B5")).toBe("=C-1$1");
  });

  it("clusters formulas that mix relative and absolute consistently", () => {
    // =$A$1+B2 should match wherever it lives if B2 has the same relative offset.
    const a = norm("=$A$1+B2", "B5");
    const b = norm("=$A$1+B3", "B6");
    expect(a).toBe(b);
  });

  it("preserves sheet qualifiers and normalizes the address", () => {
    expect(norm("=Sheet1!A1", "B5")).toBe("=Sheet1!C-1R-4");
    expect(norm("='My Sheet'!A1", "B5")).toBe("='My Sheet'!C-1R-4");
  });

  it("does not rewrite refs inside string literals", () => {
    expect(norm(`=INDIRECT("A1")`, "B5")).toBe(`=INDIRECT("A1")`);
    expect(norm(`="A1 is "&A1`, "B5")).toBe(`="A1 is "&C-1R-4`);
  });

  it("does not treat addr-shaped function names as refs", () => {
    // SUMA1 followed by ( is a function-call token, not a cell ref.
    // The B5 inside is a real ref that normalizes against the origin.
    expect(norm("=SUMA1(B5)", "B5")).toBe("=SUMA1(C+0R+0)");
  });

  it("handles range refs end-to-end", () => {
    expect(norm("=SUM(A1:C3)", "D5")).toBe("=SUM(C-3R-4:C-1R-2)");
  });

  it("handles escaped double-quotes inside string literals", () => {
    expect(norm(`="say ""hi"""&A1`, "B5")).toBe(`="say ""hi"""&C-1R-4`);
  });
});

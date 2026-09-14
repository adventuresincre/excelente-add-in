import { describe, expect, it } from "vitest";
import {
  findFormulaProblems,
  findPlaceholderLiterals,
  redactionPlaceholderIn,
  unbalancedDelimiter,
} from "./formula-check";

describe("redactionPlaceholderIn", () => {
  it("finds the placeholders a prompt-side privacy filter leaves behind", () => {
    expect(redactionPlaceholderIn("=[PERSON_NAME]:C7)")).toBe("[PERSON_NAME]");
    expect(redactionPlaceholderIn("121,800 [ADDRESS]")).toBe("[ADDRESS]");
    expect(redactionPlaceholderIn("mail [EMAIL_2] now")).toBe("[EMAIL_2]");
    expect(redactionPlaceholderIn("[SECRET:github-token]")).toBe("[SECRET:github-token]");
  });

  it("leaves structured and external references alone", () => {
    expect(redactionPlaceholderIn("=SUM(Table1[NAME])")).toBeNull();
    expect(redactionPlaceholderIn("=[Book.xlsx]Sheet1!A1")).toBeNull();
    expect(redactionPlaceholderIn("=Rent[ADDRESS]")).toBeNull();
    expect(redactionPlaceholderIn("[Property Name]")).toBeNull();
    expect(redactionPlaceholderIn("=SUM(C4:C7)")).toBeNull();
  });
});

describe("unbalancedDelimiter", () => {
  it("accepts well-formed formulas, including quotes and escaped quotes", () => {
    expect(unbalancedDelimiter('=IF(C8=0,"-",F8/C8)')).toBeNull();
    expect(unbalancedDelimiter('=TEXT(A1,"$#,##0")&" (""net"")"')).toBeNull();
    expect(unbalancedDelimiter("=SUM(Table1[[#Totals],[Rent]])")).toBeNull();
  });

  it("names the missing delimiter", () => {
    expect(unbalancedDelimiter("=SUM(I4:I7")).toBe("1 unclosed '('");
    expect(unbalancedDelimiter("=SUM(H4:H7))")).toBe("a ')' with no matching '('");
    expect(unbalancedDelimiter('=IF(A1="x,1,0)')).toMatch(/unclosed string literal/);
    expect(unbalancedDelimiter("=Table1[Rent")).toBe("1 unclosed '['");
  });

  it("ignores parentheses inside string literals", () => {
    expect(unbalancedDelimiter('="(" & A1')).toBeNull();
  });
});

describe("findFormulaProblems", () => {
  const topLeft = { col: 1, row: 7 }; // B8

  it("returns nothing for a clean grid", () => {
    const grid = [["Total", "=SUM(C4:C7)", "1", '=IF(C8=0,"-",F8/C8)']];
    expect(findFormulaProblems(grid, topLeft)).toEqual([]);
  });

  it("locates each bad formula by absolute address and says why", () => {
    const grid = [
      ["Total", "=[PERSON_NAME]:C7)", "1", "=SUM(F4:F7"],
      ["x", "=B7*D7", "[ADDRESS]", "=SUM(I4:I7)"],
    ];
    const problems = findFormulaProblems(grid, topLeft);
    expect(problems.map((p) => p.address)).toEqual(["C8", "E8"]);
    expect(problems[0].problem).toBe("contains [PERSON_NAME]");
    expect(problems[1].problem).toBe("has 1 unclosed '('");
    expect(problems[0].content).toBe("=[PERSON_NAME]:C7)");
  });

  it("does not judge literals or non-string cells", () => {
    const grid = [["[ADDRESS]", 42 as unknown as string, "(unbalanced"]];
    expect(findFormulaProblems(grid, topLeft)).toEqual([]);
  });
});

describe("findPlaceholderLiterals", () => {
  it("lists literal cells that carry a placeholder, skipping formulas", () => {
    const grid = [
      ["Unit Type", "Total [ADDRESS]", "=[PERSON_NAME]"],
      ["Studio", "[Property Name]", "[EMAIL]"],
    ];
    expect(findPlaceholderLiterals(grid, { col: 1, row: 2 })).toEqual(["C3", "D4"]);
  });
});

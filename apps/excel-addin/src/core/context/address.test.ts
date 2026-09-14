import { describe, expect, it } from "vitest";
import {
  columnIndexToLetter,
  columnLetterToIndex,
  formatA1,
  formatRange,
  parseA1,
  parseRange,
  rangeColumnCount,
  rangeRowCount,
  stripSheetQualifier,
} from "./address";

describe("stripSheetQualifier", () => {
  it("removes a bare sheet qualifier", () => {
    expect(stripSheetQualifier("Sheet1!B2:P36")).toBe("B2:P36");
  });
  it("removes a qualifier when the sheet name has spaces (unquoted)", () => {
    expect(stripSheetQualifier("DCF Template!B2:P36")).toBe("B2:P36");
  });
  it("removes a quoted sheet qualifier", () => {
    expect(stripSheetQualifier("'My Sheet'!A1")).toBe("A1");
  });
  it("leaves a sheet-local address untouched", () => {
    expect(stripSheetQualifier("B2:P36")).toBe("B2:P36");
    expect(stripSheetQualifier("A1")).toBe("A1");
  });
});

describe("parseRange / parseA1 tolerate a sheet qualifier", () => {
  it("parseRange strips the qualifier before parsing (the screenshot bug)", () => {
    expect(parseRange("DCF Template!B2:P36")).toEqual(parseRange("B2:P36"));
  });
  it("parseA1 strips the qualifier", () => {
    expect(parseA1("Sheet1!C3")).toEqual(parseA1("C3"));
  });
});

describe("columnLetterToIndex", () => {
  it.each([
    ["A", 0],
    ["B", 1],
    ["Z", 25],
    ["AA", 26],
    ["AB", 27],
    ["AZ", 51],
    ["BA", 52],
    ["AAA", 702],
  ])("%s -> %d", (letters, index) => {
    expect(columnLetterToIndex(letters)).toBe(index);
  });

  it("rejects bad input", () => {
    expect(() => columnLetterToIndex("a")).toThrow();
    expect(() => columnLetterToIndex("A1")).toThrow();
    expect(() => columnLetterToIndex("")).toThrow();
  });
});

describe("columnIndexToLetter", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [51, "AZ"],
    [52, "BA"],
    [702, "AAA"],
  ])("%d -> %s", (index, letters) => {
    expect(columnIndexToLetter(index)).toBe(letters);
  });

  it("rejects negatives", () => {
    expect(() => columnIndexToLetter(-1)).toThrow();
  });

  it("is the inverse of columnLetterToIndex", () => {
    for (let i = 0; i < 1000; i++) {
      expect(columnLetterToIndex(columnIndexToLetter(i))).toBe(i);
    }
  });
});

describe("parseA1 / formatA1", () => {
  it("parses common addresses", () => {
    expect(parseA1("A1")).toEqual({ col: 0, row: 0 });
    expect(parseA1("B5")).toEqual({ col: 1, row: 4 });
    expect(parseA1("AA100")).toEqual({ col: 26, row: 99 });
  });

  it("strips absolute markers", () => {
    expect(parseA1("$A$1")).toEqual({ col: 0, row: 0 });
    expect(parseA1("$C5")).toEqual({ col: 2, row: 4 });
    expect(parseA1("C$5")).toEqual({ col: 2, row: 4 });
  });

  it("is case-insensitive", () => {
    expect(parseA1("a1")).toEqual({ col: 0, row: 0 });
  });

  it("rejects malformed input", () => {
    expect(() => parseA1("1A")).toThrow();
    expect(() => parseA1("A")).toThrow();
    expect(() => parseA1("")).toThrow();
  });

  it("formatA1 round-trips", () => {
    expect(formatA1({ col: 0, row: 0 })).toBe("A1");
    expect(formatA1({ col: 26, row: 99 })).toBe("AA100");
  });
});

describe("parseRange / formatRange", () => {
  it("parses cell-only as a single-cell range", () => {
    expect(parseRange("B5")).toEqual({
      topLeft: { col: 1, row: 4 },
      bottomRight: { col: 1, row: 4 },
    });
  });

  it("parses a true range", () => {
    expect(parseRange("A1:C5")).toEqual({
      topLeft: { col: 0, row: 0 },
      bottomRight: { col: 2, row: 4 },
    });
  });

  it("normalizes reversed corners", () => {
    expect(parseRange("C5:A1")).toEqual({
      topLeft: { col: 0, row: 0 },
      bottomRight: { col: 2, row: 4 },
    });
  });

  it("formatRange round-trips", () => {
    expect(formatRange(parseRange("A1:C5"))).toBe("A1:C5");
    expect(formatRange(parseRange("B5"))).toBe("B5");
  });

  it("reports row + column counts", () => {
    const r = parseRange("A1:C5");
    expect(rangeRowCount(r)).toBe(5);
    expect(rangeColumnCount(r)).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  isSpreadsheetFile,
  isCsvFile,
  parseSpreadsheetToText,
  renderSpreadsheetText,
  countWorksheets,
} from "./spreadsheet";

/** Build a real .xlsx File from sheet definitions for the parser tests. */
function makeXlsxFile(name: string, sheets: Record<string, (string | number)[][]>): File {
  const wb = XLSX.utils.book_new();
  for (const [sheetName, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName);
  }
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  // `out` is typed ArrayBufferLike (could be SharedArrayBuffer-backed per
  // the lib types); cast to BlobPart for the File ctor without copying so
  // the bytes round-trip intact.
  return new File([out as unknown as BlobPart], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

describe("isSpreadsheetFile / isCsvFile", () => {
  it("recognizes spreadsheet extensions", () => {
    for (const ext of ["xlsx", "xlsm", "xls", "xlsb", "csv"]) {
      const f = new File([""], `book.${ext}`, { type: "" });
      expect(isSpreadsheetFile(f)).toBe(true);
    }
  });

  it("rejects non-spreadsheets", () => {
    expect(isSpreadsheetFile(new File([""], "photo.png", { type: "image/png" }))).toBe(false);
    expect(isSpreadsheetFile(new File([""], "doc.pdf", { type: "application/pdf" }))).toBe(false);
  });

  it("isCsvFile only true for csv", () => {
    expect(isCsvFile(new File([""], "data.csv", { type: "text/csv" }))).toBe(true);
    expect(isCsvFile(new File([""], "book.xlsx", { type: "" }))).toBe(false);
  });
});

describe("parseSpreadsheetToText", () => {
  it("parses each sheet to CSV", async () => {
    const file = makeXlsxFile("T12.xlsx", {
      Operating: [
        ["Month", "Revenue", "OpEx"],
        ["Jan", 100000, 35000],
        ["Feb", 102000, 36000],
      ],
      Summary: [["NOI", 131000]],
    });
    const parsed = await parseSpreadsheetToText(file);
    expect(parsed.filename).toBe("T12.xlsx");
    expect(parsed.sheets.map((s) => s.name)).toEqual(["Operating", "Summary"]);
    expect(parsed.sheets[0].csv).toContain("Month,Revenue,OpEx");
    expect(parsed.sheets[0].csv).toContain("Jan,100000,35000");
    expect(parsed.sheets[1].csv).toContain("NOI,131000");
  });

  it("truncates sheets past the row cap with a marker", async () => {
    const rows: (string | number)[][] = [["Header"]];
    for (let i = 0; i < 600; i++) rows.push([`row${i}`]);
    const file = makeXlsxFile("big.xlsx", { Data: rows });
    const parsed = await parseSpreadsheetToText(file);
    expect(parsed.sheets[0].truncated).toBe(true);
    expect(parsed.sheets[0].totalRows).toBeGreaterThan(500);
    expect(parsed.sheets[0].csv).toMatch(/more rows truncated/);
  });
});

describe("renderSpreadsheetText", () => {
  it("leads with a header and labels each sheet", async () => {
    const file = makeXlsxFile("RR.xlsx", {
      RentRoll: [
        ["Unit", "Rent"],
        ["101", 1500],
      ],
    });
    const parsed = await parseSpreadsheetToText(file);
    const text = renderSpreadsheetText(parsed);
    expect(text).toContain('Attached spreadsheet "RR.xlsx"');
    expect(text).toContain("=== Sheet: RentRoll");
    expect(text).toContain("Unit,Rent");
  });
});

describe("countWorksheets", () => {
  it("counts sheets without a full parse", async () => {
    const file = makeXlsxFile("multi.xlsx", {
      A: [[1]],
      B: [[2]],
      C: [[3]],
    });
    expect(await countWorksheets(file)).toBe(3);
  });
});

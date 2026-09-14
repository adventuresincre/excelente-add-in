import { describe, expect, it } from "vitest";
import { inMemoryDataSource } from "../../context";
import { createUndoStack } from "../undo";
import { padAddress, screenshotTool } from "./screenshot";

const ctx = (ds: ReturnType<typeof inMemoryDataSource>) => ({
  ds,
  undoStack: createUndoStack(),
});

const chartDs = () =>
  inMemoryDataSource({
    sheets: [
      {
        name: "Sheet1",
        charts: [
          { name: "Revenue Trend", pngDataUrl: "data:image/png;base64,REV" },
          { name: "Cost Breakdown", pngDataUrl: "data:image/png;base64,COST" },
        ],
      },
    ],
  });

describe("screenshot — range mode", () => {
  it("returns text label + image_url when no vision routing", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1", cells: { A1: { value: 1 } } }] });
    const result = await screenshotTool.execute({ sheetName: "Sheet1", address: "A1:B2" }, ctx(ds));
    if (typeof result === "string") throw new Error("expected ContentPart[] when no visionCall");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ type: "text" });
    expect(result[1]).toMatchObject({ type: "image_url" });
    if (result[0].type === "text") expect(result[0].text).toMatch(/Sheet1!A1:B2/);
    if (result[1].type === "image_url")
      expect(result[1].image_url.url).toMatch(/^data:image\/png;base64,/);
  });

  it("tolerates a sheet-qualified address and labels it cleanly (regression: InvalidArgument bug)", async () => {
    const ds = inMemoryDataSource({
      sheets: [{ name: "DCF Template", cells: { B2: { value: 1 } } }],
    });
    const result = await screenshotTool.execute(
      { sheetName: "DCF Template", address: "DCF Template!B2:P36" },
      ctx(ds)
    );
    if (typeof result === "string") throw new Error("expected ContentPart[] when no visionCall");
    // Label must not double the sheet name.
    if (result[0].type === "text") {
      expect(result[0].text).toMatch(/^Screenshot of DCF Template!B2:P36, captured as A1:S39 — /);
    }
  });

  it("captures a 3-row/3-column margin around the range by default, clamped at A1", async () => {
    const seen: string[] = [];
    const inner = inMemoryDataSource({ sheets: [{ name: "Sheet1", cells: { B2: { value: 1 } } }] });
    const ds = {
      ...inner,
      async getRangeImage(sheetName: string, address?: string) {
        seen.push(address ?? "(used range)");
        return inner.getRangeImage(sheetName, address);
      },
    };
    await screenshotTool.execute({ sheetName: "Sheet1", address: "B2:I10" }, ctx(ds));
    await screenshotTool.execute({ sheetName: "Sheet1", address: "E5:F6", margin: 1 }, ctx(ds));
    const exact = await screenshotTool.execute(
      { sheetName: "Sheet1", address: "E5:F6", margin: 0 },
      ctx(ds)
    );
    expect(seen).toEqual(["A1:L13", "D4:G7", "E5:F6"]);
    if (typeof exact === "string") throw new Error("expected ContentPart[]");
    if (exact[0].type === "text") expect(exact[0].text).toBe("Screenshot of Sheet1!E5:F6.");
  });

  it("padAddress grows every side and stops at row 1 / column A", () => {
    expect(padAddress("B2:I10", undefined)).toBe("A1:L13");
    expect(padAddress("A1", 2)).toBe("A1:C3");
    expect(padAddress("H8", 0)).toBe("H8");
    expect(padAddress("$C$3:$D$4", 1)).toBe("B2:E5");
  });

  it("captures the whole used range when address is omitted", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Inputs" }] });
    const result = await screenshotTool.execute({ sheetName: "Inputs" }, ctx(ds));
    if (typeof result === "string") throw new Error("expected ContentPart[] when no visionCall");
    if (result[0].type === "text") expect(result[0].text).toMatch(/used range/);
  });

  it("routes through visionCall when one is configured", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const visionCalls: Array<{ context: string; question?: string }> = [];
    const result = await screenshotTool.execute(
      { sheetName: "Sheet1", address: "B2:K15", what_to_check: "verify totals" },
      {
        ...ctx(ds),
        visionCall: async (args) => {
          visionCalls.push({ context: args.context, question: args.question });
          return "I see five rows, each formatted as currency.";
        },
      }
    );
    expect(visionCalls).toHaveLength(1);
    expect(visionCalls[0].context).toMatch(/Sheet1!B2:K15/);
    expect(visionCalls[0].question).toBe("verify totals");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/I see five rows/);
  });
});

describe("screenshot — chart mode", () => {
  it("captures by chartName and returns ContentPart[] with text + image_url", async () => {
    const result = await screenshotTool.execute(
      { sheetName: "Sheet1", chartName: "Revenue Trend" },
      ctx(chartDs())
    );
    expect(result).toEqual([
      { type: "text", text: 'Screenshot of chart "Revenue Trend" on sheet "Sheet1".' },
      { type: "image_url", image_url: { url: "data:image/png;base64,REV" } },
    ]);
  });

  it("captures by chartIndex", async () => {
    const result = await screenshotTool.execute(
      { sheetName: "Sheet1", chartIndex: 1 },
      ctx(chartDs())
    );
    expect(result).toEqual([
      { type: "text", text: 'Screenshot of chart at index 1 on sheet "Sheet1".' },
      { type: "image_url", image_url: { url: "data:image/png;base64,COST" } },
    ]);
  });

  it("routes a chart through visionCall when configured", async () => {
    let received: { context: string; question?: string } | null = null;
    const result = await screenshotTool.execute(
      { sheetName: "Sheet1", chartName: "Revenue Trend", what_to_check: "axis labels" },
      {
        ...ctx(chartDs()),
        visionCall: async (args) => {
          received = { context: args.context, question: args.question };
          return "X-axis is months, Y-axis is $K.";
        },
      }
    );
    expect(received).not.toBeNull();
    expect(received!.question).toBe("axis labels");
    expect(typeof result).toBe("string");
    expect(result).toMatch(/X-axis is months/);
  });

  it("throws when the named chart is missing", async () => {
    await expect(
      screenshotTool.execute({ sheetName: "Sheet1", chartName: "Nope" }, ctx(chartDs()))
    ).rejects.toThrow(/Chart "Nope" not found/);
  });
});

describe("screenshot — shape", () => {
  it("is read-only (no approval gate)", () => {
    expect(screenshotTool.requiredPermission).toBe("Read");
  });
});

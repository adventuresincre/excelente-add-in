import { describe, expect, it } from "vitest";
import { appendSelectionNote, createSteeringQueue, steeringWireContent } from "./steering";

describe("createSteeringQueue", () => {
  it("drains in post order and clears", () => {
    const q = createSteeringQueue();
    q.post({ id: "a", text: "first" });
    q.post({ id: "b", text: "second" });
    expect(q.size()).toBe(2);

    const drained = q.drain();
    expect(drained.map((m) => m.id)).toEqual(["a", "b"]);
    expect(q.size()).toBe(0);
    expect(q.drain()).toEqual([]);
  });

  it("removes an undelivered entry by id", () => {
    const q = createSteeringQueue();
    q.post({ id: "a", text: "keep" });
    q.post({ id: "b", text: "withdraw" });

    expect(q.remove("b")).toBe(true);
    expect(q.remove("b")).toBe(false); // already gone
    expect(q.drain().map((m) => m.id)).toEqual(["a"]);
  });

  it("accepts posts after a drain (same run, later boundary)", () => {
    const q = createSteeringQueue();
    q.post({ id: "a", text: "one" });
    q.drain();
    q.post({ id: "b", text: "two" });
    expect(q.drain().map((m) => m.id)).toEqual(["b"]);
  });
});

describe("appendSelectionNote", () => {
  it("appends a bracketed, sheet-qualified note", () => {
    const out = appendSelectionNote("fix this", { sheetName: "Model", address: "D12:D40" });
    expect(out).toBe(
      "fix this\n\n[User's Excel selection when this message was sent: 'Model'!D12:D40]"
    );
  });

  it("doubles apostrophes in sheet names, Excel-style", () => {
    const out = appendSelectionNote("check", { sheetName: "Q3 '25 Model", address: "B2" });
    expect(out).toContain("'Q3 ''25 Model'!B2");
  });

  it("emits the note alone when the text is empty", () => {
    const out = appendSelectionNote("", { sheetName: "S", address: "A1:B2" });
    expect(out.startsWith("[User's Excel selection")).toBe(true);
  });
});

describe("steeringWireContent", () => {
  it("passes plain text through untouched", () => {
    expect(steeringWireContent({ id: "x", text: "use the 2025 tab" })).toBe("use the 2025 tab");
  });

  it("appends the selection note when a selection rode along", () => {
    const out = steeringWireContent({
      id: "x",
      text: "these cells",
      selection: { sheetName: "Inputs", address: "C3:C9" },
    });
    expect(out).toContain("these cells");
    expect(out).toContain("'Inputs'!C3:C9");
  });
});

import { describe, expect, it } from "vitest";
import { assertImagePayload } from "./datasource";

/**
 * `Range.getImage` / `Chart.getImage` support varies by Excel host. The
 * failure that matters is not an exception — it is a successful sync that
 * yields an empty `value`, which would otherwise become a well-formed but
 * empty `data:image/png;base64,` URL. The model would then describe a blank
 * image as though it were the workbook.
 */
describe("assertImagePayload", () => {
  it("rejects an empty payload from a host that doesn't support capture", () => {
    expect(() => assertImagePayload("", "Sheet1!A1:B2")).toThrow(/empty image/i);
    expect(() => assertImagePayload(undefined, "Sheet1!A1:B2")).toThrow(/empty image/i);
  });

  it("rejects a truncated payload too small to be a real image", () => {
    expect(() => assertImagePayload("iVBORw0KGgo=", 'chart "Revenue"')).toThrow(/empty image/i);
  });

  it("names what failed so the agent can pick a different approach", () => {
    expect(() => assertImagePayload("", 'chart "Revenue Trend" on Model')).toThrow(
      /chart "Revenue Trend" on Model/
    );
    // And points at the fallback rather than inviting a retry of the same call.
    expect(() => assertImagePayload("", "Sheet1")).toThrow(/inspect_workbook/);
  });

  it("accepts a real image payload", () => {
    expect(() => assertImagePayload("A".repeat(5_000), "Sheet1!A1:D20")).not.toThrow();
  });
});

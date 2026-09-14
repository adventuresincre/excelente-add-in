import { describe, expect, it } from "vitest";
import { isIndexedDbClosingError } from "./indexeddb";

describe("isIndexedDbClosingError", () => {
  it("matches the WebKit message seen on Excel for Mac", () => {
    expect(
      isIndexedDbClosingError(
        new DOMException(
          "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
          "InvalidStateError"
        )
      )
    ).toBe(true);
  });

  it("matches a plain Error with the closing text", () => {
    expect(isIndexedDbClosingError(new Error("The database connection is closing."))).toBe(true);
  });

  it("does not treat unrelated failures as closing", () => {
    expect(isIndexedDbClosingError(new Error("getAll failed"))).toBe(false);
    expect(
      isIndexedDbClosingError(new Error("IndexedDB is not available in this environment"))
    ).toBe(false);
  });
});

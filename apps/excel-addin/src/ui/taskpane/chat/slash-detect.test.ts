import { describe, expect, it } from "vitest";
import { detectSlashToken, replaceSlashToken } from "./slash-detect";

describe("detectSlashToken", () => {
  it("detects a slash token at the start of the input", () => {
    expect(detectSlashToken("/und", 4)).toEqual({ start: 0, end: 4, query: "und" });
  });

  it("detects an empty query right after the slash", () => {
    expect(detectSlashToken("/", 1)).toEqual({ start: 0, end: 1, query: "" });
  });

  it("detects a slash token after whitespace", () => {
    expect(detectSlashToken("hello /und", 10)).toEqual({ start: 6, end: 10, query: "und" });
  });

  it("returns null when caret is at offset 0 (no '/' to the left)", () => {
    expect(detectSlashToken("/foo", 0)).toBeNull();
  });

  it("returns null when caret is past the token", () => {
    expect(detectSlashToken("/foo bar", 8)).toBeNull(); // caret in "bar"
  });

  it("returns null when the word doesn't start with '/'", () => {
    expect(detectSlashToken("foo", 3)).toBeNull();
    expect(detectSlashToken("hello foo", 9)).toBeNull();
  });

  it("returns null for url-like '//' sequences", () => {
    // Caret right after "https:" — previous '/' is preceded by non-space, no whitespace at start
    expect(detectSlashToken("https://foo", 11)).toBeNull();
  });

  it("keeps the menu open when caret is mid-token", () => {
    expect(detectSlashToken("/und", 2)).toEqual({ start: 0, end: 4, query: "und" });
  });
});

describe("replaceSlashToken", () => {
  it("deletes the token entirely when replacement is empty", () => {
    const { text, caret } = replaceSlashToken("hello /und", { start: 6, end: 10, query: "und" });
    expect(text).toBe("hello ");
    expect(caret).toBe(6);
  });

  it("eats a single trailing space when collapsing to empty", () => {
    const { text, caret } = replaceSlashToken("hello /und world", {
      start: 6,
      end: 10,
      query: "und",
    });
    expect(text).toBe("hello world");
    expect(caret).toBe(6);
  });

  it("inserts a non-empty replacement and positions the caret after it", () => {
    const { text, caret } = replaceSlashToken(
      "hello /und",
      { start: 6, end: 10, query: "und" },
      "underwriting"
    );
    expect(text).toBe("hello underwriting");
    expect(caret).toBe(6 + "underwriting".length);
  });
});

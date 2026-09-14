import { describe, expect, it } from "vitest";
import { shouldActivateAfterAdd } from "./activate-connector";

describe("shouldActivateAfterAdd", () => {
  it("turns the connector on after a successful handshake", () => {
    expect(shouldActivateAfterAdd({ status: "connected" })).toBe(true);
  });

  it("leaves the connector off when the handshake failed", () => {
    expect(shouldActivateAfterAdd({ status: "error" })).toBe(false);
  });

  it("leaves the connector off while still connecting", () => {
    expect(shouldActivateAfterAdd({ status: "connecting" })).toBe(false);
  });

  it("leaves the connector off when the server never landed in the list", () => {
    expect(shouldActivateAfterAdd(undefined)).toBe(false);
  });
});

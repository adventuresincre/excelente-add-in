import { describe, expect, it } from "vitest";
import {
  deriveOperatingMode,
  isSessionValid,
  shouldRefresh,
  REFRESH_SKEW_MS,
} from "./operating-mode";
import type { Session } from "./types";

const NOW = 1_000_000_000_000;

function session(expiresAt: number): Session {
  return {
    token: "tok",
    tokenType: "Bearer",
    expiresAt,
    member: { id: "m1", email: "a@b.com", tier: "pro", accelerator: false },
  };
}

describe("isSessionValid", () => {
  it("is false for null", () => {
    expect(isSessionValid(null, NOW)).toBe(false);
  });
  it("is true while unexpired", () => {
    expect(isSessionValid(session(NOW + 1000), NOW)).toBe(true);
  });
  it("is false once expired", () => {
    expect(isSessionValid(session(NOW - 1), NOW)).toBe(false);
  });
});

describe("shouldRefresh", () => {
  it("is false when expired", () => {
    expect(shouldRefresh(session(NOW - 1), NOW)).toBe(false);
  });
  it("is true within the skew window", () => {
    expect(shouldRefresh(session(NOW + REFRESH_SKEW_MS - 1), NOW)).toBe(true);
  });
  it("is false when comfortably valid", () => {
    expect(shouldRefresh(session(NOW + REFRESH_SKEW_MS + 60_000), NOW)).toBe(false);
  });
});

describe("deriveOperatingMode", () => {
  it("is member when the session is valid (even if a key is also set)", () => {
    expect(deriveOperatingMode({ session: session(NOW + 1000), apiKey: "sk", now: NOW })).toBe(
      "member"
    );
  });
  it("is byok when no valid session but a key is set", () => {
    expect(deriveOperatingMode({ session: null, apiKey: "sk", now: NOW })).toBe("byok");
  });
  it("downgrades an expired session to byok when a key exists", () => {
    expect(deriveOperatingMode({ session: session(NOW - 1), apiKey: "sk", now: NOW })).toBe("byok");
  });
  it("is guest with neither a valid session nor a key", () => {
    expect(deriveOperatingMode({ session: null, apiKey: null, now: NOW })).toBe("guest");
  });
  it("an expired session with no key is guest (never silently 'member')", () => {
    expect(deriveOperatingMode({ session: session(NOW - 1), apiKey: null, now: NOW })).toBe(
      "guest"
    );
  });
});

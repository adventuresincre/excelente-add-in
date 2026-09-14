import { describe, expect, it } from "vitest";
import { inMemoryBackend } from "../storage";
import { createSessionStore } from "./session-store";
import type { Session } from "./types";

function makeSession(over: Partial<Session> = {}): Session {
  return {
    token: "tok-123",
    tokenType: "Bearer",
    expiresAt: Date.now() + 60_000,
    member: {
      id: "m1",
      email: "spencer@adventuresincre.com",
      displayName: "Spencer",
      tier: "accelerator",
      accelerator: true,
    },
    ...over,
  };
}

describe("SessionStore", () => {
  it("round-trips a session", async () => {
    const store = createSessionStore(inMemoryBackend());
    expect(await store.get()).toBeNull();
    const s = makeSession();
    await store.set(s);
    expect(await store.get()).toEqual(s);
  });

  it("rejects an empty token", async () => {
    const store = createSessionStore(inMemoryBackend());
    await expect(store.set(makeSession({ token: "" }))).rejects.toThrow();
  });

  it("clear() drops the token but keeps the email hint for re-auth", async () => {
    const store = createSessionStore(inMemoryBackend());
    await store.set(makeSession());
    await store.clear();
    expect(await store.get()).toBeNull();
    expect(await store.getEmailHint()).toBe("spencer@adventuresincre.com");
  });

  it("forget() wipes both the token and the email hint", async () => {
    const store = createSessionStore(inMemoryBackend());
    await store.set(makeSession());
    await store.forget();
    expect(await store.get()).toBeNull();
    expect(await store.getEmailHint()).toBeNull();
  });

  it("preserves an expired session on read (validity is decided by the caller)", async () => {
    const store = createSessionStore(inMemoryBackend());
    const expired = makeSession({ expiresAt: Date.now() - 1000 });
    await store.set(expired);
    expect(await store.get()).toEqual(expired);
  });

  it("returns null for corrupt stored JSON", async () => {
    const backend = inMemoryBackend();
    await backend.setItem("excelente.member.session", "{not json");
    const store = createSessionStore(backend);
    expect(await store.get()).toBeNull();
  });

  it("returns null when required member fields are missing", async () => {
    const backend = inMemoryBackend();
    await backend.setItem(
      "excelente.member.session",
      JSON.stringify({ token: "t", expiresAt: Date.now() + 1000, member: { id: "x" } })
    );
    const store = createSessionStore(backend);
    expect(await store.get()).toBeNull();
  });

  it("round-trips an optional refresh token and omits it when absent", async () => {
    const store = createSessionStore(inMemoryBackend());
    await store.set(makeSession({ refreshToken: "refresh-abc" }));
    expect((await store.get())?.refreshToken).toBe("refresh-abc");

    await store.forget();
    await store.set(makeSession());
    expect((await store.get())?.refreshToken).toBeUndefined();
  });
});

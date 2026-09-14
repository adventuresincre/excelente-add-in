import { describe, expect, it, vi } from "vitest";
import { AuthClientError, createAuthClient } from "./auth-client";

const BASE = "https://hub.example.com/api/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MEMBER = {
  id: "m-1",
  email: "analyst@example.com",
  tier: "Pro",
  accelerator: true,
};

describe("requestCode", () => {
  it("POSTs the email and returns requestId + TTL", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse({ requestId: "req-1", expiresInSec: 600 }));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const result = await client.requestCode("analyst@example.com");

    expect(result).toEqual({ requestId: "req-1", expiresInSec: 600 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/auth/request-code`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      email: "analyst@example.com",
    });
  });

  it("maps 429 to rate_limited with retryAfterSec", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ retryAfterSec: 42 }, 429));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.requestCode("a@b.com").catch((e) => e);
    expect(err).toBeInstanceOf(AuthClientError);
    expect(err.code).toBe("rate_limited");
    expect(err.retryAfterSec).toBe(42);
  });

  it("rejects a malformed 200 body as http error", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ nope: true }));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.requestCode("a@b.com").catch((e) => e);
    expect(err.code).toBe("http");
  });

  it("maps a fetch failure to a network error", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("offline"));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.requestCode("a@b.com").catch((e) => e);
    expect(err.code).toBe("network");
  });
});

describe("verifyCode", () => {
  const VERIFY_ARGS = {
    requestId: "req-1",
    email: "analyst@example.com",
    code: "123456",
  };

  it("returns a parsed Session on success", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({
        token: "session-token",
        tokenType: "Bearer",
        expiresAt: Date.now() + 86_400_000,
        refreshToken: "refresh-token",
        member: MEMBER,
      })
    );
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const session = await client.verifyCode(VERIFY_ARGS);

    expect(session.token).toBe("session-token");
    expect(session.refreshToken).toBe("refresh-token");
    expect(session.member.email).toBe("analyst@example.com");
    expect(session.member.accelerator).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${BASE}/auth/verify-code`);
    expect(JSON.parse(init.body as string)).toEqual(VERIFY_ARGS);
  });

  it("maps 401 to invalid_code", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 401));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.verifyCode(VERIFY_ARGS).catch((e) => e);
    expect(err.code).toBe("invalid_code");
  });

  it("maps 410 to code_expired", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}, 410));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.verifyCode(VERIFY_ARGS).catch((e) => e);
    expect(err.code).toBe("code_expired");
  });

  it("rejects a 200 whose body fails session validation", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ token: "", member: MEMBER }));
    const client = createAuthClient({ baseUrl: BASE, fetchImpl });

    const err = await client.verifyCode(VERIFY_ARGS).catch((e) => e);
    expect(err.code).toBe("http");
  });
});

describe("createAuthClient", () => {
  it("strips a trailing slash from the base URL", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ requestId: "r", expiresInSec: 1 }));
    const client = createAuthClient({ baseUrl: `${BASE}/`, fetchImpl });

    await client.requestCode("a@b.com");
    expect(fetchImpl.mock.calls[0][0]).toBe(`${BASE}/auth/request-code`);
  });
});

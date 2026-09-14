import { DEFAULT_INTEL_HUB_API_BASE } from "../config";
import { parseSession } from "./session-store";
import type { Session } from "./types";

/**
 * Client for the Intel Hub's email one-time-code auth (A.CRE member mode;
 * §1, camelCase JSON):
 *
 *   1. `requestCode(email)` → the Hub emails a short code, returns a
 *      `requestId` + code TTL.
 *   2. `verifyCode({ requestId, email, code })` → a full member `Session`
 *      (bearer token + member), which the caller persists via SessionStore.
 *
 * Errors surface as `AuthClientError` with a stable `code` so the UI can
 * branch (cooldown countdown vs. "wrong code, try again" vs. "code
 * expired, request a new one").
 */

export type AuthErrorCode =
  /** 429 on request-code — resend cooldown; `retryAfterSec` may be set. */
  | "rate_limited"
  /** 401 on verify-code — the code didn't match. */
  | "invalid_code"
  /** 410 on verify-code — the code's TTL lapsed; request a new one. */
  | "code_expired"
  /** fetch itself failed (offline, DNS, CORS). */
  | "network"
  /** Any other non-2xx, or a malformed 2xx body. */
  | "http";

export class AuthClientError extends Error {
  constructor(
    message: string,
    public readonly code: AuthErrorCode,
    public readonly status?: number,
    /** Present on `rate_limited` when the Hub said how long to wait. */
    public readonly retryAfterSec?: number
  ) {
    super(message);
    this.name = "AuthClientError";
  }
}

export interface RequestCodeResult {
  requestId: string;
  /** How long the emailed code stays valid. */
  expiresInSec: number;
}

export interface AuthClient {
  /** Ask the Hub to email a one-time code to `email`. */
  requestCode(email: string): Promise<RequestCodeResult>;
  /** Exchange the emailed code for a member session. */
  verifyCode(args: { requestId: string; email: string; code: string }): Promise<Session>;
}

export function createAuthClient(
  opts: { baseUrl?: string; fetchImpl?: typeof fetch } = {}
): AuthClient {
  const baseUrl = (opts.baseUrl ?? DEFAULT_INTEL_HUB_API_BASE).replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);

  async function post(path: string, body: unknown): Promise<Response> {
    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new AuthClientError(
        `Could not reach the A.CRE sign-in service: ${(e as Error).message}`,
        "network"
      );
    }
  }

  return {
    async requestCode(email) {
      const response = await post("/auth/request-code", { email });
      const json = await safeJson(response);
      if (response.status === 429) {
        const retryAfterSec = readNumber(json, "retryAfterSec");
        throw new AuthClientError(
          retryAfterSec
            ? `Too many requests — try again in ${retryAfterSec}s.`
            : "Too many requests — try again shortly.",
          "rate_limited",
          response.status,
          retryAfterSec
        );
      }
      if (!response.ok) throw httpError(response);
      const requestId = readString(json, "requestId");
      const expiresInSec = readNumber(json, "expiresInSec");
      if (!requestId || !expiresInSec) {
        throw new AuthClientError(
          "Sign-in service returned an unexpected response.",
          "http",
          response.status
        );
      }
      return { requestId, expiresInSec };
    },

    async verifyCode({ requestId, email, code }) {
      const response = await post("/auth/verify-code", { requestId, email, code });
      if (response.status === 401) {
        throw new AuthClientError(
          "That code didn't match — check the email and try again.",
          "invalid_code",
          response.status
        );
      }
      if (response.status === 410) {
        throw new AuthClientError(
          "That code has expired — request a new one.",
          "code_expired",
          response.status
        );
      }
      if (!response.ok) throw httpError(response);
      const session = parseSession(await safeJson(response));
      if (!session) {
        throw new AuthClientError(
          "Sign-in service returned an unexpected response.",
          "http",
          response.status
        );
      }
      return session;
    },
  };
}

function httpError(response: Response): AuthClientError {
  return new AuthClientError(
    `Sign-in service error (HTTP ${response.status}).`,
    "http",
    response.status
  );
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readString(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null) return null;
  const v = (value as Record<string, unknown>)[key];
  return typeof v === "string" && v ? v : null;
}

/** Reads `key` from the top level OR from a §7 `{ error: { … } }` envelope. */
function readNumber(value: unknown, key: string): number | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const record = value as Record<string, unknown>;
  const direct = record[key];
  if (typeof direct === "number" && Number.isFinite(direct)) return direct;
  const nested = record.error;
  if (typeof nested === "object" && nested !== null) {
    const v = (nested as Record<string, unknown>)[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

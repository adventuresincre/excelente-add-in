import { officeBackend, type StorageBackend } from "../storage";
import type { Member, Session } from "./types";

const KEY_SESSION = "excelente.member.session";
/**
 * The member's email is persisted separately and *survives* `clear()` so an
 * expired-session user gets a pre-filled, one-tap re-auth. `clear()` wipes the
 * token but keeps the hint; `forget()` wipes both (full sign-out / new user).
 */
const KEY_EMAIL_HINT = "excelente.member.emailHint";

export interface SessionStore {
  /** Read the stored session (may be expired — caller decides validity). */
  get(): Promise<Session | null>;
  set(session: Session): Promise<void>;
  /** Drop the token but keep the email hint for easy re-auth. */
  clear(): Promise<void>;
  /** Drop the token AND the email hint. */
  forget(): Promise<void>;
  /** Last-known member email, for pre-filling the re-auth form. */
  getEmailHint(): Promise<string | null>;
}

export function createSessionStore(backend: StorageBackend = officeBackend()): SessionStore {
  return {
    async get() {
      const raw = await backend.getItem(KEY_SESSION);
      if (!raw) return null;
      try {
        return parseSession(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async set(session) {
      if (!session.token.trim()) {
        throw new Error("session token cannot be empty");
      }
      await backend.setItem(KEY_SESSION, JSON.stringify(session));
      if (session.member.email) {
        await backend.setItem(KEY_EMAIL_HINT, session.member.email);
      }
    },
    async clear() {
      await backend.removeItem(KEY_SESSION);
    },
    async forget() {
      await backend.removeItem(KEY_SESSION);
      await backend.removeItem(KEY_EMAIL_HINT);
    },
    async getEmailHint() {
      return backend.getItem(KEY_EMAIL_HINT);
    },
  };
}

/**
 * Validate an untrusted value into a `Session`, or null if malformed. Used
 * for both stored JSON and the Hub's verify/refresh responses (the wire
 * shape IS the session shape).
 */
export function parseSession(value: unknown): Session | null {
  if (!isObject(value)) return null;
  const { token, expiresAt, refreshToken, member } = value;
  if (typeof token !== "string" || !token) return null;
  if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;
  const parsedMember = parseMember(member);
  if (!parsedMember) return null;
  const session: Session = {
    token,
    tokenType: "Bearer",
    expiresAt,
    member: parsedMember,
  };
  if (typeof refreshToken === "string" && refreshToken) {
    session.refreshToken = refreshToken;
  }
  return session;
}

function parseMember(value: unknown): Member | null {
  if (!isObject(value)) return null;
  const { id, email, displayName, tier, accelerator } = value;
  if (typeof id !== "string" || !id) return null;
  if (typeof email !== "string" || !email) return null;
  const member: Member = {
    id,
    email,
    tier: typeof tier === "string" ? tier : "",
    accelerator: accelerator === true,
  };
  if (typeof displayName === "string" && displayName) {
    member.displayName = displayName;
  }
  return member;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

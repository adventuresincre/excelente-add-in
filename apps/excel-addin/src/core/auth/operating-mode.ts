import type { OperatingMode, Session } from "./types";

/** Seconds before `expiresAt` at which we consider a token worth refreshing. */
export const REFRESH_SKEW_MS = 5 * 60 * 1000;

/** A session is usable only while its token has not expired. */
export function isSessionValid(session: Session | null, now: number = Date.now()): boolean {
  return session !== null && session.expiresAt > now;
}

/** True when the token is valid but close enough to expiry to refresh now. */
export function shouldRefresh(session: Session | null, now: number = Date.now()): boolean {
  if (!isSessionValid(session, now)) return false;
  return session!.expiresAt - now <= REFRESH_SKEW_MS;
}

/**
 * Derive the active operating mode from actual capability — not from any
 * stored preference. A valid member session wins; otherwise a BYOK key; else
 * guest. The user's *chosen path* (which welcome variant to show, e.g. member
 * re-auth) is tracked separately and never grants member capability on its own.
 */
export function deriveOperatingMode(args: {
  session: Session | null;
  apiKey: string | null;
  now?: number;
}): OperatingMode {
  const { session, apiKey, now = Date.now() } = args;
  if (isSessionValid(session, now)) return "member";
  if (apiKey) return "byok";
  return "guest";
}

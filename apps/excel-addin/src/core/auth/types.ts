/**
 * Auth + operating-mode types for the dual-mode add-in.
 *
 * The add-in can run in one of three operating modes, distinct from the
 * chat plan/work mode:
 *   - "byok"   — the user supplied an OpenRouter key; calls go direct to
 *                openrouter.ai (the original self-serve experience).
 *   - "member" — an authenticated A.CRE Intel Hub session; calls route
 *                through the A.CRE relay (server-side keys, metered credits).
 *   - "guest"  — no credential; only the guidance-only concierge is available.
 *
 * Member-ness is always gated on a *valid* session token — never on a
 * persisted preference — so an expired session degrades to a re-auth prompt
 * rather than silently granting member features.
 */
export type OperatingMode = "byok" | "member" | "guest";

/** Curated model tiers a member can select. */
export type TierId = "lite" | "standard" | "power";

/** The authenticated member, as returned by the Intel Hub on verify. */
export interface Member {
  id: string;
  email: string;
  displayName?: string;
  /** Membership descriptor from the Hub (e.g. plan name). Informational. */
  tier: string;
  /** True if the member is an A.CRE Accelerator participant. */
  accelerator: boolean;
}

/** A live (or recently-expired) member session held in storage. */
export interface Session {
  /** Opaque bearer token sent to the relay / authed config + skill endpoints. */
  token: string;
  tokenType: "Bearer";
  /** Absolute expiry, epoch ms. */
  expiresAt: number;
  /** Optional long-lived token used to silently refresh `token`. */
  refreshToken?: string;
  member: Member;
}

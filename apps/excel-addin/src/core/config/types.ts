import type { ReasoningLevel } from "../storage";
import type { TierId } from "../auth/types";

/**
 * The config document the Intel Hub serves so models, default settings,
 * Skills, and MCP servers can change without redeploying the add-in to
 * Microsoft. Fetched in two slices: `public` (no auth — drives the welcome
 * screen, concierge, and BYOK defaults) and `member` (Bearer — entitlements,
 * credits, relay endpoint, remote skills, managed MCP).
 */
export interface RemoteConfig {
  /** Monotonic semantic version; a bump invalidates derived client state. */
  version: number;
  /** HTTP entity tag for conditional revalidation. */
  etag: string;
  /** How often the client should re-poll, in seconds (server-driven). */
  refreshIntervalSec: number;
  public: PublicConfig;
  /** Present only on the authenticated fetch. */
  member?: MemberConfig;
}

export interface PublicConfig {
  byokDefaults: ByokDefaults;
  concierge: ConciergeConfig;
  tiers: ModelTier[];
  announcements?: Announcement[];
  /** If the running add-in is older than this, show an "update" notice. */
  minClientVersion?: string;
}

/** Defaults applied when a BYOK user saves a key without explicit model picks. */
export interface ByokDefaults {
  primaryModelId: string;
  visionModelId?: string;
  summaryModelId?: string;
  reasoning: ReasoningLevel;
  maxTurns: number;
}

export interface ConciergeConfig {
  /** A.CRE-hosted, no-auth, rate-limited endpoint. */
  endpoint: string;
  /** Shown in the UI ("powered by …"). */
  modelLabel: string;
  /** Server-side prompt id; the client only sends conversation turns. */
  systemPromptId: string;
  rateLimit: { perMinute: number; perDay: number };
  /** Kill-switch. */
  disabled?: boolean;
}

export interface ModelTier {
  id: TierId;
  label: string;
  description: string;
  /** Role→model mapping the relay enforces (mirrors ModelPref roles). */
  roles: TierRoles;
  reasoning: ReasoningLevel;
  /**
   * Optional markup knob. Credits are intrinsically `round(cost × 100)` (1
   * credit = 1¢ of underlying cost), so pricier models already cost more
   * credits without a multiplier — leave unset (treated as 1) unless you want
   * an extra per-tier markup applied server-side.
   */
  creditMultiplier?: number;
}

export interface TierRoles {
  primaryModelId: string;
  subagentModelId?: string;
  visionModelId?: string;
  summaryModelId?: string;
}

export interface Announcement {
  id: string;
  level: "info" | "warn";
  text: string;
  /** Epoch ms after which the announcement should no longer show. */
  until?: number;
}

export interface MemberConfig {
  entitlements: Entitlements;
  credits: Credits;
  relay: { baseUrl: string };
  skills: AcreSkillEntry[];
  mcp: AcreMcpEntry[];
}

export interface Entitlements {
  tierIds: TierId[];
  defaultTierId: TierId;
  accelerator: boolean;
}

/**
 * A purchased / auto-topped-up credit balance (1 credit = 1¢ of underlying
 * model cost). `balance` here is only a *seed* for launch/sign-in; after each
 * message the relay's `credits_remaining` (in the usage chunk) is the
 * authoritative live balance. Auto-topup is transparent to the add-in — the
 * next message simply reports the higher balance.
 */
export interface Credits {
  /** Seed balance at fetch time. */
  balance: number;
  unit: "credits";
  /** Below this, the UI shows a calm, non-blocking "running low" badge. */
  lowThreshold: number;
  /**
   * Below this, the add-in won't START a new message (and the relay rejects a
   * turn-start call with 402). A message already in flight always runs to
   * completion — better that an answer finishes than gets cut off — so the
   * balance may dip marginally below zero; the Hub reconciles on the next
   * topup / allocation.
   */
  minSendThreshold: number;
  /** Optional: the level auto-topup refills to. Display only. */
  autoTopupTo?: number;
}

export interface AcreSkillEntry {
  /** lower-kebab, matches SkillFrontmatter.name. */
  name: string;
  description: string;
  whenToUse?: string;
  version?: string;
  /** Gated by entitlements.accelerator. */
  acceleratorOnly: boolean;
  /** Authed GET → SKILL.md body (fetched lazily to keep config small). */
  bodyUrl: string;
  resourceManifest?: Array<{ path: string; url: string }>;
}

export interface AcreMcpEntry {
  /** lower-kebab (validates via isValidMcpServerName). */
  name: string;
  /** JSON-RPC endpoint. */
  url: string;
  authMode: "member-token";
  acceleratorOnly?: boolean;
  /** Always true — managed servers are not user-removable. */
  managed: true;
}

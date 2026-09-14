import type { PublicConfig } from "./types";

/**
 * Default Intel Hub API base for A.CRE member mode. Auth, config,
 * concierge, and the A.CRE-hosted MCP endpoints all hang off this base
 * until the Hub's `/config/public` says otherwise.
 */
export const DEFAULT_INTEL_HUB_API_BASE = "https://intelligence.adventuresincre.com/api/v1";

/**
 * Hardcoded fallback public config bundled with the add-in. Used on the very
 * first launch (before any successful fetch) and whenever the Intel Hub is
 * unreachable, so the welcome screen renders and BYOK works end-to-end with
 * sensible default models even fully offline. The Hub's `/config/public`
 * overrides all of this once reachable.
 */
export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  byokDefaults: {
    // First-run picks applied the moment a BYOK key is saved. Change these
    // (or override via Intel Hub `/config/public`) whenever the recommended
    // stack moves — no picker UI change required.
    //
    // Owner decision (2026-09-04): every role is x-ai/grok-4.6 EXCEPT
    // summary. Model lineups churn constantly, and one id across the
    // interactive roles is the arrangement least likely to leave a stale
    // recommendation in one role while another stays current. Users still
    // pick anything on OpenRouter — these are first-run defaults, not a
    // supported-model list.
    //
    // Summary is the deliberate exception: it drives the compaction
    // meta-call, which runs unattended once per long session and needs
    // throughput and context, not top-tier reasoning. glm-5.3-flash is a
    // flash-tier model with a 1.31M context window — the largest of
    // anything we default to, which is the property that matters when the
    // job is folding a ~200k-token conversation into one summary.
    //
    // Both ids verified against the live OpenRouter catalogue 2026-09-04
    // (grok-4.6: tools+vision, 500k ctx; glm-5.3-flash: tools+vision, 1.31M ctx).
    primaryModelId: "x-ai/grok-4.6",
    visionModelId: "x-ai/grok-4.6",
    summaryModelId: "z-ai/glm-5.3-flash",
    reasoning: "low",
    // Longer: the agent does more before pausing. First-run used to
    // default to Balanced (50); CRE workbook jobs routinely run longer.
    // Doubled 2026-09-12 (100 -> 200) after live testing: institutional
    // builds were hitting the ceiling mid-work often enough that the pause
    // read as a failure rather than a check-in.
    maxTurns: 200,
  },
  concierge: {
    endpoint: `${DEFAULT_INTEL_HUB_API_BASE}/concierge`,
    modelLabel: "A.CRE Concierge",
    systemPromptId: "concierge-v1",
    rateLimit: { perMinute: 5, perDay: 50 },
  },
  tiers: [
    {
      id: "lite",
      label: "Lite",
      description: "Fast, low-cost answers for quick questions and light edits.",
      roles: {
        primaryModelId: "x-ai/grok-4.6",
        summaryModelId: "z-ai/glm-5.3-flash",
        visionModelId: "x-ai/grok-4.6",
      },
      reasoning: "off",
    },
    {
      id: "standard",
      label: "Standard",
      description: "Balanced power for everyday modeling and analysis.",
      roles: {
        primaryModelId: "x-ai/grok-4.6",
        summaryModelId: "z-ai/glm-5.3-flash",
        visionModelId: "x-ai/grok-4.6",
      },
      reasoning: "off",
    },
    {
      id: "power",
      label: "Power",
      description: "Maximum reasoning for complex, multi-step builds.",
      roles: {
        primaryModelId: "x-ai/grok-4.6",
        subagentModelId: "x-ai/grok-4.6",
        summaryModelId: "z-ai/glm-5.3-flash",
        visionModelId: "x-ai/grok-4.6",
      },
      reasoning: "medium",
    },
  ],
};

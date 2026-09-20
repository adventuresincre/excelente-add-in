import type { PublicConfig } from "./types";

/**
 * The settings bundled with the add-in. Used on first launch so the
 * welcome screen renders and BYOK works end-to-end with sensible default
 * models. Changing a default here is a code change and a deploy.
 */
export const DEFAULT_PUBLIC_CONFIG: PublicConfig = {
  byokDefaults: {
    // First-run picks applied the moment a BYOK key is saved. Change these
    // whenever the recommended stack moves — no picker UI change required.
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
};

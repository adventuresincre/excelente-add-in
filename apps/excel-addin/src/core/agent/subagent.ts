import {
  DEFAULT_SUBAGENT_READONLY_ALLOWLIST,
  type SubagentOptions,
  type SubagentResult,
} from "../tools";
import { createOrchestrator, type OrchestratorDeps, type RunOptions } from "./orchestrator";

/**
 * Run an isolated child orchestrator.
 *
 * The child inherits the parent's data source, tool registry, undo stack,
 * OpenRouter client, model, reasoning, and approval handler. It does NOT
 * inherit the parent's conversation history — only the `prompt` reaches it.
 *
 * Default allowlist is read-only (`DEFAULT_SUBAGENT_READONLY_ALLOWLIST`) so a
 * sub-agent can't surprise the user with writes the parent never proposed.
 * A wider allowlist requires explicit opt-in from the parent.
 *
 * The child's intermediate tool calls are discarded; only its final
 * assistant text becomes the `summary` in the returned `SubagentResult`.
 */
export async function runSubagent(
  parentDeps: OrchestratorDeps,
  // `roleApiKey` rides along so a sub-agent's own role calls (its vision
  // describer, its compaction summary) can reach the same account the parent
  // resolved for role overrides.
  parentRunOpts: Pick<RunOptions, "apiKey" | "roleApiKey" | "modelId" | "reasoning" | "signal">,
  subOpts: SubagentOptions
): Promise<SubagentResult> {
  const child = createOrchestrator(parentDeps);

  const allowlist = subOpts.toolAllowlist ?? [...DEFAULT_SUBAGENT_READONLY_ALLOWLIST];
  const maxTurns = subOpts.maxTurns ?? 6;

  let summary = "";
  let cost: number | undefined;
  let turns = 0;

  for await (const event of child.run({
    apiKey: parentRunOpts.apiKey,
    roleApiKey: parentRunOpts.roleApiKey,
    modelId: parentRunOpts.modelId,
    reasoning: parentRunOpts.reasoning,
    systemPrompt: subOpts.systemPrompt,
    messages: [{ role: "user", content: subOpts.prompt }],
    toolAllowlist: allowlist,
    maxTurns,
    // Sub-agents default to Read — they investigate and report back. Typed
    // roles can opt up to Write (Builder); writes still go through the
    // parent's approval flow because the orchestrator deps are shared.
    sessionPermission: subOpts.sessionPermission ?? "Read",
    isSubagent: true,
    signal: parentRunOpts.signal,
  })) {
    switch (event.type) {
      case "text-delta":
        summary += event.text;
        break;
      case "stream-retry":
        // The child is replaying a turn whose partial output we already
        // accumulated. Drop exactly that much, or the summary carries the
        // fragment twice.
        if (event.discard) summary = summary.slice(0, summary.length - event.discard.text);
        break;
      case "usage":
        if (typeof event.usage.cost === "number") {
          cost = (cost ?? 0) + event.usage.cost;
        }
        break;
      case "tool-call-result":
      case "tool-call-error":
        turns++;
        break;
      case "done":
        // One done event per child run.
        break;
    }
  }

  return {
    summary: summary.trim(),
    cost,
    turns,
  };
}

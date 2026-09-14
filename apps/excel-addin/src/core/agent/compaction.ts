import type { ChatMessage } from "../openrouter";

/**
 * Tool results that are NEVER compacted. These tools return reference
 * material the agent intentionally fetched and needs to keep referring to
 * throughout the build — skill bodies, skill resource files (answer keys,
 * step-by-step playbooks), workbook conventions / memory. Compacting these
 * forces a re-fetch later in the conversation, which costs more tokens
 * than just keeping them in place AND visibly degrades model behavior.
 */
const COMPACTION_EXEMPT_TOOLS = new Set([
  "load_skill",
  "read_skill_resource",
  "read_workbook_memory",
]);

/**
 * Default token budget at which compaction kicks in. ~200k matches the
 * practical context cliff for most large-context models (Claude / GPT-5)
 * AND keeps Excelente working comfortably under the stated capacity of
 * smaller-window models like Kimi K2.6 (262k) and Qwen 3.7 Max (1M
 * stated, ~200-300k useful before quality degradation).
 *
 * The budget is intentionally a working-set target, NOT the model's
 * stated context window. Models routinely lose track of fine detail
 * once their input grows past ~150k regardless of how big their
 * advertised window is — compaction protects against that cliff.
 */
const DEFAULT_TOKEN_BUDGET = 200_000;

/**
 * The last RECENT_FLOOR messages always survive verbatim — the active
 * turn, the user's most recent ask, and at least one full
 * tool-call/result/assistant cycle of immediate context.
 */
const RECENT_FLOOR = 10;

/**
 * Signature of the summarizer callback the orchestrator supplies. Returns
 * the structured summary text that becomes the replacement system-role
 * message. Compaction calls this exactly once per trip over budget.
 */
export type Summarizer = (compactable: ChatMessage[]) => Promise<string>;

export interface CompactionResult {
  /** The new messages array, with the compactable window replaced by a single summary message. */
  messages: ChatMessage[];
  /** How many messages were folded into the summary — surfaced for UI ("Compacted 24 earlier messages…"). */
  compactedCount: number;
  /** The summary text itself — useful for surfacing to the UI / persisting alongside conversation. */
  summary: string;
}

/**
 * Estimate the message array's wire-token count using the standard
 * 4-chars-per-token heuristic plus small per-message overhead and a
 * vision baseline (~250 tok/image). Real tokenizers (tiktoken etc.) would
 * be more accurate but would ship a 4MB JS payload to the task pane for
 * order-of-magnitude accuracy that's good enough to drive a trigger.
 *
 * Exported so the orchestrator can decide WHEN to trigger compaction
 * (cheap predicate) before deciding to PAY for the summarizer call
 * (expensive operation).
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let total = 0;
  for (const m of messages) total += estimateMessageTokens(m);
  return total;
}

export function needsCompaction(messages: ChatMessage[], budget = DEFAULT_TOKEN_BUDGET): boolean {
  return estimateTokens(messages) > budget;
}

/**
 * Compact the conversation by replacing older user/assistant/tool messages
 * with a single LLM-generated summary. Reference-tool exempt messages
 * (load_skill, read_skill_resource, read_workbook_memory) and the most
 * recent RECENT_FLOOR messages stay verbatim — the agent loses none of
 * its loaded playbooks or its immediate context.
 *
 * Token budget defaults to ~200k. Caller should check `needsCompaction`
 * first to avoid the meta-call when the conversation is under budget.
 *
 * The summarizer callback makes one network call to the configured
 * summary model (typically the same primary; can be overridden to a
 * cheaper model). Cost per compaction: ~$0.005-0.02 on cheap models,
 * ~$0.02-0.10 on Opus. Amortized across the rest of the session it
 * pays for itself many times over.
 *
 * Returns the new messages array plus metadata for the UI. When the
 * compactable window turns out to be empty (e.g., the conversation is
 * over budget purely because of exempt reference content), no
 * summarizer call is made — `compactedCount` is 0 and `messages` is
 * returned unchanged.
 */
export async function compactMessages(
  messages: ChatMessage[],
  summarizer: Summarizer
): Promise<CompactionResult> {
  // Back the cutoff up off any tool result so `recent` starts at the
  // assistant turn that issued it. A position-based slice can otherwise
  // land between an assistant `tool_calls` message and its results,
  // orphaning those results — see `repairToolCallPairing`. Backing up
  // keeps the REAL assistant message (with real arguments) rather than
  // leaving the repair pass to reconstruct a placeholder.
  const cutoffIdx = alignCutoffToTurnStart(messages, Math.max(0, messages.length - RECENT_FLOOR));

  const before: ChatMessage[] = []; // system + reference-exempt
  const compactable: ChatMessage[] = [];

  for (let i = 0; i < cutoffIdx; i++) {
    const msg = messages[i];
    if (msg.role === "system") {
      before.push(msg);
    } else if (msg.role === "tool" && msg.name && COMPACTION_EXEMPT_TOOLS.has(msg.name)) {
      before.push(msg);
    } else {
      compactable.push(msg);
    }
  }

  // Nothing eligible to compact. Caller should still get the original
  // messages back; the budget will get reduced anyway via Wave 9b's
  // reference-tool exemption + RECENT_FLOOR slimming on the wire.
  if (compactable.length === 0) {
    return { messages, compactedCount: 0, summary: "" };
  }

  const summary = await summarizer(compactable);

  const summaryMessage: ChatMessage = {
    role: "system",
    content: `[COMPACTED EARLIER CONVERSATION — ${compactable.length} messages summarized below]\n\n${summary}`,
  };

  const recent = messages.slice(cutoffIdx);
  return {
    messages: repairToolCallPairing([...before, summaryMessage, ...recent]),
    compactedCount: compactable.length,
    summary,
  };
}

/**
 * Walk back off a run of tool results so the index lands on the assistant
 * message that issued them (or on a non-tool message).
 */
function alignCutoffToTurnStart(messages: ChatMessage[], idx: number): number {
  let i = Math.min(idx, messages.length);
  while (i > 0 && messages[i]?.role === "tool") i--;
  return i;
}

/**
 * Restore the assistant→tool pairing the wire format requires: every
 * `role:"tool"` message must be preceded by an assistant message whose
 * `tool_calls` declares its `tool_call_id`. Providers reject the request
 * with a 400 otherwise.
 *
 * Compaction breaks the pairing on purpose-built paths: exempt tool results
 * (`load_skill` and friends) are deliberately hoisted out of the compactable
 * window and survive, but the assistant turn that called them is summarized
 * away. Loading a skill early is the norm here, so without this repair the
 * FIRST compaction of a normal session produces a wire-invalid conversation
 * — and the failure lands on the next `client.chat` call, which is not the
 * compaction call, making it look unrelated. The session then can't recover:
 * every retry replays the same history, re-compacts, and fails identically.
 *
 * Orphans are re-parented to a synthetic assistant turn rather than dropped,
 * because dropping them would discard exactly the reference material the
 * exemption exists to preserve. The reconstructed call carries the tool's
 * name and empty arguments — the result content is what matters downstream.
 */
export function repairToolCallPairing(messages: ChatMessage[]): ChatMessage[] {
  const declared = new Set<string>();
  const out: ChatMessage[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "assistant") {
      if (msg.tool_calls) for (const tc of msg.tool_calls) declared.add(tc.id);
      out.push(msg);
      continue;
    }

    // Non-tool, or a tool message we can't repair (no id to pair against),
    // or one whose caller is already present: pass through.
    if (msg.role !== "tool" || !msg.tool_call_id || declared.has(msg.tool_call_id)) {
      out.push(msg);
      continue;
    }

    // Orphan. Gather the contiguous run of orphans so one synthetic
    // assistant turn adopts all of them instead of one turn each.
    const run: ChatMessage[] = [];
    let j = i;
    for (; j < messages.length; j++) {
      const t = messages[j];
      if (t.role !== "tool" || !t.tool_call_id || declared.has(t.tool_call_id)) break;
      run.push(t);
    }

    out.push({
      role: "assistant",
      content: "",
      tool_calls: run.map((t) => ({
        id: t.tool_call_id as string,
        type: "function" as const,
        function: { name: t.name ?? "tool", arguments: "{}" },
      })),
    });
    for (const t of run) {
      declared.add(t.tool_call_id as string);
      out.push(t);
    }
    i = j - 1;
  }

  return out;
}

function estimateMessageTokens(msg: ChatMessage): number {
  // Role + name + tool_call_id + minor JSON overhead.
  let total = 8;
  if (msg.name) total += Math.ceil(msg.name.length / 4);
  if (msg.tool_call_id) total += Math.ceil(msg.tool_call_id.length / 4);
  if (typeof msg.content === "string") {
    total += Math.ceil(msg.content.length / 4);
  } else if (Array.isArray(msg.content)) {
    for (const part of msg.content) {
      if (part.type === "text") {
        total += Math.ceil(part.text.length / 4);
      } else if (part.type === "image_url") {
        total += 250;
      }
    }
  }
  if (msg.tool_calls) {
    for (const tc of msg.tool_calls) {
      total += Math.ceil((tc.function.name.length + tc.function.arguments.length) / 4);
    }
  }
  return total;
}

export { COMPACTION_EXEMPT_TOOLS, DEFAULT_TOKEN_BUDGET, RECENT_FLOOR };

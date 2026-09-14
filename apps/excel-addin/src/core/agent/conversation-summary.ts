import type { ChatMessage, OpenRouterClient } from "../openrouter";

/**
 * One-shot meta-call that summarizes a chunk of conversation history so the
 * full session can be compacted in place. The summary becomes a single
 * system-role message that replaces the source window in subsequent turns.
 *
 * The agent will pick up the conversation from the summary — so the prompt
 * is shaped to emit a structured report (work-in-progress, tool calls,
 * facts established, errors, outstanding items) rather than free-form
 * narrative. Token target: ~500-1500 output. Input: whatever was in the
 * compactable window (can be 50-150k tokens).
 *
 * Defaults to using the primary model. Power users can override via
 * `summaryModelId` in `ModelPref` to point at a cheaper model (Haiku,
 * Qwen-Turbo, GPT-5-mini) since summarization doesn't need top-tier
 * reasoning.
 */

const SYSTEM_PROMPT = `You are summarizing a conversation between a user and an AI agent (Excelente) that builds and edits Excel workbooks on the user's behalf. The agent will continue the conversation AFTER reading your summary, so it needs the state of the work in compact form.

Produce a terse, structured summary in this exact format:

## Work in progress
- What the agent is building / editing.
- Current workbook + active sheet (if known).
- Plan step the agent is on (if applicable, e.g. "Step 4 of 9: build Pro Forma sheet").

## Tool calls made
- One line per significant call: tool_name(brief args) → outcome.
- Skip routine reads; ALWAYS include writes.
- Group repeated similar calls ("wrote labels to Assumptions!B2:B20 in 3 chunks").

## Facts established
- Verified cell values, named ranges, sheet structures.
- User conventions / preferences mentioned.
- Anything the agent will need to remember.

## Errors / blocked approaches
- Failed approaches and why.
- Validation errors and how they were resolved.

## Outstanding
- What's left to do (in order if there's a plan).
- What's blocked on user input.

Use the agent's notation: cell references like B5, formulas like =SUM(A:A), sheet!range like Direct Cap!I44. Be terse. Skip filler. The agent should read this and immediately resume work without re-asking.`;

export interface SummarizeArgs {
  apiKey: string;
  /**
   * Model used for the meta-call. Defaults to the primary; power users
   * can pass a cheaper model (Haiku, Qwen-Turbo) to bring per-compaction
   * cost down — summarization doesn't need top-tier reasoning.
   */
  modelId: string;
  /** Conversation window to summarize. */
  messages: ChatMessage[];
  /** Abort signal threaded through from the parent run. */
  signal?: AbortSignal;
}

export async function summarizeConversation(
  client: OpenRouterClient,
  args: SummarizeArgs
): Promise<string> {
  // Flatten the compactable window into a single user-role payload. We
  // could pass the messages array verbatim, but a structured "Here's the
  // conversation transcript" frame helps cheap summarizers stay on task.
  const transcript = args.messages
    .map((m) => formatMessageForTranscript(m))
    .filter((s) => s.length > 0)
    .join("\n\n");

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: `Summarize this conversation segment. Output the structured report only — no preamble.\n\n=== TRANSCRIPT START ===\n\n${transcript}\n\n=== TRANSCRIPT END ===`,
    },
  ];

  let out = "";
  for await (const ev of client.chat({
    apiKey: args.apiKey,
    model: args.modelId,
    messages,
    signal: args.signal,
  })) {
    if (ev.type === "text-delta") out += ev.text;
  }
  return out.trim();
}

/**
 * Render a ChatMessage as a compact transcript line for the summarizer.
 * - System messages → skipped (the summarizer already has its own system
 *   prompt; injecting the parent's system would confuse it).
 * - Tool calls → "[ASSISTANT called tool_name(args)]" — keeps the agent's
 *   actions visible to the summarizer.
 * - Tool results → "[TOOL tool_name returned: brief]" — values present
 *   so the summarizer can capture facts established.
 * - Multi-part content (vision) → stripped to text + "[image]" markers.
 */
function formatMessageForTranscript(msg: ChatMessage): string {
  if (msg.role === "system") return "";

  const content =
    typeof msg.content === "string"
      ? msg.content
      : msg.content
          .map((part) => {
            if (part.type === "text") return part.text;
            if (part.type === "image_url") return "[image]";
            return "";
          })
          .join(" ");

  if (msg.role === "user") {
    return `USER: ${content}`;
  }
  if (msg.role === "assistant") {
    let line = `ASSISTANT: ${content}`;
    if (msg.tool_calls && msg.tool_calls.length > 0) {
      const calls = msg.tool_calls
        .map((tc) => `${tc.function.name}(${truncate(tc.function.arguments, 200)})`)
        .join(", ");
      line += `\n[called: ${calls}]`;
    }
    return line;
  }
  if (msg.role === "tool") {
    const name = msg.name ?? "tool";
    return `TOOL ${name}: ${truncate(content, 600)}`;
  }
  return "";
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}… [+${s.length - max} more chars]`;
}

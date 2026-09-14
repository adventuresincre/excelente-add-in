import type { ChatMessage } from "../openrouter";

/**
 * Tools whose outputs are reference material the agent intentionally
 * fetched and needs in full — skill bodies, skill resource files (answer
 * keys, playbooks), workbook conventions. Truncating these makes the agent
 * dumber: it loses access to the middle of the doc it just loaded. Always
 * pass these through verbatim.
 */
const TRUNCATION_EXEMPT_TOOLS = new Set([
  "load_skill",
  "read_skill_resource",
  "read_workbook_memory",
]);

/**
 * Cap the wire-size of a tool result as a SAFETY NET for genuinely runaway
 * outputs — not as an aggressive cost lever. The threshold is set high
 * (~120k tokens / 480k chars) so normal usage (sheet outlines, range
 * reads, even verbose inspect_workbook(scope='sheet') dumps) ships
 * verbatim. Only truly pathological reads (a 200k-token raw paste of an
 * entire workbook by an over-eager agent) get cut.
 *
 * Reference-fetch tools (load_skill, read_skill_resource,
 * read_workbook_memory) are exempt from truncation entirely — agents need
 * those docs in full and dropping the middle would visibly degrade
 * behavior.
 *
 * Applied right before the tool result is pushed to the conversation, so
 * the UI still gets the full result for display (via the tool-call-result
 * event); only the model's view is shrunk when the safety net trips.
 *
 * Multi-part content (image_url, etc.) passes through untouched — vision
 * routing already converts those to text, and direct image content has its
 * own per-provider sizing.
 */

const DEFAULT_MAX_CHARS = 480_000; // ~120k tokens at the 4-chars-per-token heuristic

export function truncateToolResultMessage(
  msg: ChatMessage,
  maxChars = DEFAULT_MAX_CHARS
): ChatMessage {
  if (msg.role !== "tool") return msg;
  if (typeof msg.content !== "string") return msg;
  if (msg.name && TRUNCATION_EXEMPT_TOOLS.has(msg.name)) return msg;
  if (msg.content.length <= maxChars) return msg;

  const head = msg.content.slice(0, Math.floor(maxChars * 0.75));
  const tail = msg.content.slice(-Math.floor(maxChars * 0.15));
  const droppedChars = msg.content.length - head.length - tail.length;
  const droppedTokens = Math.round(droppedChars / 4);

  const truncated =
    head +
    `\n\n[... ${droppedTokens.toLocaleString()} tokens truncated (${droppedChars.toLocaleString()} chars). ` +
    `Narrow the call (scope="sheet" or scope="range") or read the workbook outline first if you need more. ...]\n\n` +
    tail;

  return { ...msg, content: truncated };
}

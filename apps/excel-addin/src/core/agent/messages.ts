import type { ChatMessage, ContentPart } from "../openrouter";

/**
 * Helpers for shaping OpenRouter / OpenAI-format chat messages. Lives next
 * to the orchestrator because it owns the conversation array, but used by
 * `useAgentStream`'s `itemsToMessages` too — keeping these helpers in one
 * place ensures the orchestrator and the UI emit the same tool-call /
 * tool-result shape.
 */

/**
 * Wrap a tool's return value in the `role: "tool"` ChatMessage shape. The
 * content is stringified JSON unless it's already a string or an array of
 * content parts (the vision-style multi-part shape).
 *
 * `toolName` is optional but recommended — it gets attached as the `name`
 * field on the message, which lets downstream wire-prep passes
 * (compaction, truncation) treat reference-fetch results (load_skill,
 * read_skill_resource, read_workbook_memory) differently from transient
 * state reads. OpenAI's chat API supports `name` on tool messages and
 * OpenRouter passes it through.
 */
export function toolResultMessage(
  callId: string,
  content: unknown,
  toolName?: string
): ChatMessage {
  const base: ChatMessage =
    Array.isArray(content) && content.every(isContentPart)
      ? {
          role: "tool",
          tool_call_id: callId,
          content: content as ContentPart[],
        }
      : {
          role: "tool",
          tool_call_id: callId,
          content: typeof content === "string" ? content : JSON.stringify(content),
        };
  if (toolName) base.name = toolName;
  return base;
}

function isContentPart(v: unknown): v is ContentPart {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.type === "text" || r.type === "image_url";
}

/**
 * Shape a tool call for an assistant message's `tool_calls` field. Public
 * so `useAgentStream`'s lossless replay can reconstruct full conversation
 * history when restoring a saved chat.
 */
export function buildToolCall(
  callId: string,
  name: string,
  argumentsJson: string
): { id: string; type: "function"; function: { name: string; arguments: string } } {
  return {
    id: callId,
    type: "function",
    function: { name, arguments: argumentsJson },
  };
}

/** Public wrapper around `toolResultMessage` — same function, exposed for
 * symmetry with `buildToolCall` so external callers have a clean API
 * without poking through the orchestrator. */
export const buildToolResultMessage = toolResultMessage;

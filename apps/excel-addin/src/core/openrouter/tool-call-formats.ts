/**
 * Adapters for non-OpenAI tool-call wire formats.
 *
 * Most providers (Anthropic, OpenAI, Google, xAI, DeepSeek, Qwen) emit tool
 * calls in OpenAI's streaming format — chunks contain `delta.tool_calls` with
 * structured `id` + `function.name` + `function.arguments` fields. Our base
 * SSE translator handles that case directly.
 *
 * Moonshot's Kimi family (in scope for Excelente as a strong cheap option)
 * deviates: tool calls arrive as special tokens embedded in `delta.content`
 * rather than as structured `delta.tool_calls`. The shape is roughly:
 *
 *   <|tool_calls_section_begin|>
 *     <|tool_call_begin|>functions.foo:0
 *     <|tool_call_argument_begin|>{"x": 1}
 *     <|tool_call_end|>
 *   <|tool_calls_section_end|>
 *
 * This module recovers structured calls from that token format so the rest of
 * the pipeline doesn't need to know the model emitted them non-standardly.
 * If Kimi releases a future version that follows the OpenAI spec, this parser
 * still finds nothing in normal content and adds no overhead.
 */

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * Extract Kimi-format tool calls from accumulated assistant content. Returns
 * an empty array when no Kimi tokens are present. The parser is forgiving:
 * extra whitespace between tokens is fine, and a missing `<|tool_call_end|>`
 * at the very end of a truncated stream still yields what was parsed so far.
 *
 * `id`s are generated deterministically from the call index because Kimi
 * doesn't issue ids — the rest of the pipeline (orchestrator, UI) only needs
 * them to be unique within a turn.
 */
export function parseKimiToolCalls(content: string): ParsedToolCall[] {
  if (!content.includes("<|tool_call_begin|>")) return [];

  // Each call: <|tool_call_begin|> NAME(:INDEX)? <|tool_call_argument_begin|> ARGS <|tool_call_end|>
  // Trailing <|tool_call_end|> can be absent if the stream was truncated mid-token.
  const pattern =
    /<\|tool_call_begin\|>\s*([^<\s]+?)\s*<\|tool_call_argument_begin\|>([\s\S]*?)(?:<\|tool_call_end\|>|<\|tool_calls_section_end\|>|$)/g;

  const calls: ParsedToolCall[] = [];
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = pattern.exec(content)) !== null) {
    const rawName = match[1] ?? "";
    // Kimi names look like "functions.foo:0" — strip the "functions." prefix
    // and any ":index" suffix.
    const cleaned = rawName.replace(/^functions\./, "").replace(/:\d+$/, "");
    const args = (match[2] ?? "").trim();
    if (!cleaned) {
      i++;
      continue;
    }
    calls.push({
      id: `kimi_${i}`,
      name: cleaned,
      arguments: args,
    });
    i++;
  }
  return calls;
}

/**
 * Minimal SSE parser for OpenAI-compatible streams.
 *
 * The OpenAI / OpenRouter streaming format emits one `data: <json>` line per
 * chunk, separated by blank lines, terminated by `data: [DONE]`. This parser
 * handles that shape only; it is not a fully spec-compliant SSE implementation.
 */
export async function* parseSseLines(stream: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.length > 0) {
          const trailing = extractDataLine(buffer);
          if (trailing !== null && trailing !== "[DONE]") {
            yield trailing;
          }
        }
        return;
      }
      buffer += decoder.decode(value, { stream: true });

      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const rawLine = buffer.slice(0, newlineIdx);
        buffer = buffer.slice(newlineIdx + 1);
        const data = extractDataLine(rawLine);
        if (data === null) continue;
        if (data === "[DONE]") return;
        yield data;
      }
    }
  } finally {
    // cancel(), not releaseLock(). Releasing only detaches the reader; the
    // response body — and the HTTP request behind it — stays open, so the
    // provider keeps generating and billing a reply nobody will read. Every
    // early exit lands here: a consumer `break`, a throw in the translator,
    // `.return()` from a generator up the chain. Abort-driven exits are
    // already torn down by fetch's signal; this covers the rest. After a
    // normal close cancel is a no-op, and on an errored stream it rejects
    // with the error we already have — hence the swallow. Not awaited: a
    // slow source must not stall the caller's own cleanup.
    void reader.cancel().catch(() => undefined);
  }
}

function extractDataLine(line: string): string | null {
  const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
  if (trimmed === "" || trimmed.startsWith(":")) return null;
  if (!trimmed.startsWith("data:")) return null;
  // RFC 8259: a single space after the colon is stripped if present.
  const payload = trimmed.slice(5);
  return payload.startsWith(" ") ? payload.slice(1) : payload;
}

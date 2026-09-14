import { describe, expect, it } from "vitest";
import { parseSseLines } from "./sse";

function streamFromString(
  s: string,
  chunkSize = Number.POSITIVE_INFINITY
): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(s);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + chunkSize, bytes.length);
      controller.enqueue(bytes.slice(offset, end));
      offset = end;
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const out: string[] = [];
  for await (const line of parseSseLines(stream)) {
    out.push(line);
  }
  return out;
}

describe("parseSseLines", () => {
  it("yields data payloads separated by newlines", async () => {
    const sse = `data: {"a":1}\n\ndata: {"b":2}\n\n`;
    expect(await collect(streamFromString(sse))).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("stops at [DONE]", async () => {
    const sse = `data: {"a":1}\n\ndata: [DONE]\n\ndata: {"never":true}\n\n`;
    expect(await collect(streamFromString(sse))).toEqual([`{"a":1}`]);
  });

  it("ignores comment lines and blank lines", async () => {
    const sse = `: keep-alive\n\ndata: {"ok":true}\n\n`;
    expect(await collect(streamFromString(sse))).toEqual([`{"ok":true}`]);
  });

  it("handles CRLF line endings", async () => {
    const sse = `data: {"a":1}\r\n\r\ndata: {"b":2}\r\n\r\n`;
    expect(await collect(streamFromString(sse))).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("strips the optional single space after the colon", async () => {
    const sse = `data:{"compact":true}\n\ndata: {"spaced":true}\n\n`;
    expect(await collect(streamFromString(sse))).toEqual([`{"compact":true}`, `{"spaced":true}`]);
  });

  it("buffers across chunk boundaries", async () => {
    const sse = `data: {"a":1}\n\ndata: {"b":2}\n\n`;
    // Force a 3-byte chunk size so most lines split mid-payload
    expect(await collect(streamFromString(sse, 3))).toEqual([`{"a":1}`, `{"b":2}`]);
  });

  it("yields trailing data line if stream ends without final newline", async () => {
    const sse = `data: {"a":1}`;
    expect(await collect(streamFromString(sse))).toEqual([`{"a":1}`]);
  });

  // releaseLock() only detaches the reader; the HTTP response behind the
  // stream stays open and the provider keeps generating for nobody. Every
  // early exit — a consumer break, a throw downstream — must cancel the body
  // so the connection actually closes.
  it("cancels the underlying stream when the consumer stops early", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"a":1}\n\ndata: {"b":2}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const line of parseSseLines(stream)) {
      expect(line).toBe(`{"a":1}`);
      break;
    }
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });

  it("cancels the underlying stream when the consumer throws", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"a":1}\n\n`));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      (async () => {
        for await (const line of parseSseLines(stream)) {
          throw new Error(`boom on ${line}`);
        }
      })()
    ).rejects.toThrow(/boom/);
    await Promise.resolve();
    expect(cancelled).toBe(true);
  });
});

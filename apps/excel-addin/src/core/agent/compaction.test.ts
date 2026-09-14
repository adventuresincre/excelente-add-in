import { describe, expect, it, vi } from "vitest";
import { compactMessages, estimateTokens, needsCompaction } from "./compaction";
import type { ChatMessage } from "../openrouter";

function userMsg(text: string): ChatMessage {
  return { role: "user", content: text };
}
function assistantMsg(text: string): ChatMessage {
  return { role: "assistant", content: text };
}
function toolMsg(text: string, id = "call_x", name?: string): ChatMessage {
  const msg: ChatMessage = { role: "tool", tool_call_id: id, content: text };
  if (name) msg.name = name;
  return msg;
}

describe("estimateTokens / needsCompaction", () => {
  it("returns roughly chars/4 for small messages", () => {
    // 5-char user message → ~1 token + ~8 overhead ≈ 9 tokens.
    expect(estimateTokens([userMsg("hello")])).toBeGreaterThan(0);
    expect(estimateTokens([userMsg("hello")])).toBeLessThan(20);
  });

  it("needsCompaction false for short sessions, true past budget", () => {
    expect(needsCompaction([userMsg("hi"), assistantMsg("hello")])).toBe(false);
    // Push way past the default 200k budget.
    const huge = "x".repeat(1_000_000);
    expect(needsCompaction([userMsg(huge)])).toBe(true);
  });

  it("respects a caller-supplied budget", () => {
    const messages = [userMsg("x".repeat(40_000))]; // ~10k tokens
    expect(needsCompaction(messages, 100_000)).toBe(false);
    expect(needsCompaction(messages, 5_000)).toBe(true);
  });
});

describe("compactMessages", () => {
  it("returns the input unchanged when the compactable window is empty", async () => {
    // Only system + reference-exempt tool messages — nothing to compact.
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      toolMsg("skill body", "call_1", "load_skill"),
    ];
    const summarizer = vi.fn(async () => "should not be called");
    const result = await compactMessages(messages, summarizer);
    expect(result.compactedCount).toBe(0);
    expect(result.messages).toBe(messages);
    expect(summarizer).not.toHaveBeenCalled();
  });

  it("compacts older user/assistant/tool messages into a single summary", async () => {
    // Older messages (positions 0–9) get compacted; recent 10 stay verbatim.
    // Need at least 11 messages to have something past RECENT_FLOOR.
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      userMsg("start"),
      assistantMsg("ack"),
      toolMsg("transient output", "call_1", "inspect_workbook"),
      assistantMsg("more"),
      userMsg("another ask"),
      assistantMsg("response"),
      toolMsg("another", "call_2", "inspect_workbook"),
      assistantMsg("after"),
      userMsg("fresh"),
      assistantMsg("fresh ack"),
      userMsg("most recent"),
      assistantMsg("very recent"),
      toolMsg("most recent tool", "call_3", "inspect_workbook"),
    ];
    const summarizer = vi.fn<(compactable: ChatMessage[]) => Promise<string>>(
      async () => "## Summary\n- did things"
    );
    const result = await compactMessages(messages, summarizer);
    expect(summarizer).toHaveBeenCalledOnce();
    // The summarizer was given the compactable window (everything older
    // than the last 10 messages, minus system + reference-exempt).
    const firstCall = summarizer.mock.calls[0];
    expect(firstCall).toBeDefined();
    const givenToSummarizer = firstCall![0];
    expect(givenToSummarizer.length).toBeGreaterThan(0);
    // System prompt always survives.
    expect(result.messages[0].role).toBe("system");
    // A new system-role message containing the summary appears.
    const summaryIdx = result.messages.findIndex(
      (m) =>
        m.role === "system" &&
        typeof m.content === "string" &&
        m.content.includes("COMPACTED EARLIER CONVERSATION")
    );
    expect(summaryIdx).toBeGreaterThan(-1);
    // Recent messages stay verbatim.
    const recent = result.messages.slice(-3);
    expect(recent[recent.length - 1]).toEqual(messages[messages.length - 1]);
  });

  it("preserves reference-fetch tools (load_skill, read_skill_resource, read_workbook_memory) verbatim", async () => {
    const skill = toolMsg("skill body content", "call_1", "load_skill");
    const resource = toolMsg("answer key", "call_2", "read_skill_resource");
    const memory = toolMsg("conventions", "call_3", "read_workbook_memory");
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      skill,
      resource,
      memory,
      // Compactable filler past the cutoff.
      ...Array.from({ length: 20 }, (_, i) => assistantMsg(`turn ${i}`)),
    ];
    const summarizer = vi.fn(async () => "summary");
    const result = await compactMessages(messages, summarizer);
    // All three reference tools must still be present, identical.
    expect(result.messages).toContain(skill);
    expect(result.messages).toContain(resource);
    expect(result.messages).toContain(memory);
  });

  /**
   * Every `role:"tool"` message must be preceded by an assistant message
   * whose `tool_calls` declares its id, or the provider 400s. Asserting the
   * exempt tool messages merely *survive* (above) misses this entirely — the
   * old bug shipped precisely because presence was checked and pairing
   * wasn't.
   */
  function assertToolPairingValid(messages: ChatMessage[]): void {
    const declared = new Set<string>();
    for (const m of messages) {
      if (m.role === "assistant" && m.tool_calls) {
        for (const tc of m.tool_calls) declared.add(tc.id);
      }
      if (m.role === "tool") {
        expect(m.tool_call_id).toBeDefined();
        expect(
          declared.has(m.tool_call_id as string),
          `orphaned tool message ${m.tool_call_id} has no preceding assistant tool_calls`
        ).toBe(true);
      }
    }
  }

  it("keeps exempt tool results paired with an assistant turn after compaction", async () => {
    // The assistant turn that CALLED load_skill is old enough to be
    // summarized away, while the exempt result is hoisted out and survives.
    // That is the orphan the provider rejects.
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      userMsg("load the underwriting skill"),
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_skill",
            type: "function",
            function: { name: "load_skill", arguments: '{"name":"x"}' },
          },
        ],
      },
      toolMsg("skill body content", "call_skill", "load_skill"),
      ...Array.from({ length: 20 }, (_, i) => assistantMsg(`turn ${i}`)),
    ];

    const result = await compactMessages(messages, async () => "summary");

    expect(result.messages.some((m) => m.role === "tool" && m.tool_call_id === "call_skill")).toBe(
      true
    );
    assertToolPairingValid(result.messages);
  });

  it("does not orphan tool results when the recent-window cutoff splits a turn", async () => {
    // Build a tail where the RECENT_FLOOR boundary lands between an
    // assistant tool_calls message and its results.
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 12 }, (_, i) => assistantMsg(`old ${i}`)),
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_a",
            type: "function",
            function: { name: "inspect_workbook", arguments: "{}" },
          },
          {
            id: "call_b",
            type: "function",
            function: { name: "inspect_workbook", arguments: "{}" },
          },
        ],
      },
      toolMsg("a", "call_a", "inspect_workbook"),
      toolMsg("b", "call_b", "inspect_workbook"),
      ...Array.from({ length: 8 }, (_, i) => assistantMsg(`tail ${i}`)),
    ];

    const result = await compactMessages(messages, async () => "summary");
    assertToolPairingValid(result.messages);
  });

  it("includes the compactedCount + summary text in the result for the UI", async () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      ...Array.from({ length: 15 }, (_, i) => assistantMsg(`turn ${i}`)),
      userMsg("recent"),
    ];
    const summarizer = vi.fn(async () => "structured summary text");
    const result = await compactMessages(messages, summarizer);
    expect(result.compactedCount).toBeGreaterThan(0);
    expect(result.summary).toBe("structured summary text");
  });

  it("recent messages always survive even when over budget by a wide margin", async () => {
    const recentMarker = userMsg("MOST RECENT");
    const messages: ChatMessage[] = [
      ...Array.from({ length: 30 }, () => assistantMsg("x".repeat(50_000))),
      recentMarker,
    ];
    const result = await compactMessages(messages, async () => "summary");
    // The last message (recentMarker) is always preserved.
    expect(result.messages[result.messages.length - 1]).toEqual(recentMarker);
  });
});

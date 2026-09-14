import { describe, expect, it } from "vitest";
import { truncateToolResultMessage } from "./truncation";
import type { ChatMessage } from "../openrouter";

describe("truncateToolResultMessage", () => {
  it("returns the message unchanged when content fits under the cap", () => {
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_1",
      content: "short result",
    };
    expect(truncateToolResultMessage(msg, 100)).toBe(msg);
  });

  it("truncates with a head + tail + 'how to see more' hint", () => {
    const big = "x".repeat(20_000);
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_1",
      content: big,
    };
    const out = truncateToolResultMessage(msg, 4000);
    expect(typeof out.content).toBe("string");
    const c = out.content as string;
    expect(c.length).toBeLessThan(big.length);
    expect(c).toMatch(/tokens truncated/);
    expect(c).toMatch(/Narrow the call/);
    // Head + tail preserved
    expect(c.startsWith("x")).toBe(true);
    expect(c.endsWith("x")).toBe(true);
  });

  it("does not touch non-tool messages", () => {
    const msg: ChatMessage = {
      role: "assistant",
      content: "x".repeat(50_000),
    };
    expect(truncateToolResultMessage(msg, 100)).toBe(msg);
  });

  it("does not touch multi-part content (vision-style)", () => {
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_x",
      content: [
        { type: "text", text: "screenshot" },
        { type: "image_url", image_url: { url: "data:image/png;base64,X" } },
      ],
    };
    expect(truncateToolResultMessage(msg, 100)).toBe(msg);
  });

  it("preserves tool_call_id across truncation", () => {
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_specific",
      content: "x".repeat(10_000),
    };
    const out = truncateToolResultMessage(msg, 500);
    expect(out.tool_call_id).toBe("call_specific");
  });

  it("never truncates reference-fetch tools — load_skill / read_skill_resource / read_workbook_memory", () => {
    // These return reference docs the agent intentionally loaded. Truncating
    // means dropping the middle of the doc, which visibly degrades behavior.
    const big = "Step 1 detail X. ".repeat(5000); // ~85k chars
    for (const tool of ["load_skill", "read_skill_resource", "read_workbook_memory"]) {
      const msg: ChatMessage = {
        role: "tool",
        tool_call_id: "call",
        name: tool,
        content: big,
      };
      const out = truncateToolResultMessage(msg, 1000);
      expect(out.content).toBe(big);
    }
  });

  it("default threshold is high enough to leave normal tool outputs intact", () => {
    // The Wave 9b default is ~120k tokens (480k chars). Even a verbose
    // inspect_workbook(scope='sheet') outline on a dense workbook (~20k
    // chars) should pass through verbatim.
    const verboseOutline = "# Sheet: X\n".repeat(2000); // ~22k chars
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_x",
      name: "inspect_workbook",
      content: verboseOutline,
    };
    const out = truncateToolResultMessage(msg);
    expect(out.content).toBe(verboseOutline);
  });

  it("still trips on genuinely runaway outputs (safety net)", () => {
    // Half a million chars from a single tool result is pathological —
    // get cut even though the threshold is high.
    const runaway = "x".repeat(600_000);
    const msg: ChatMessage = {
      role: "tool",
      tool_call_id: "call_huge",
      name: "inspect_workbook",
      content: runaway,
    };
    const out = truncateToolResultMessage(msg);
    expect((out.content as string).length).toBeLessThan(runaway.length);
    expect(out.content).toMatch(/tokens truncated/);
  });
});

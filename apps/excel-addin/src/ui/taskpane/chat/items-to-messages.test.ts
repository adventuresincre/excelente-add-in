import { describe, expect, it } from "vitest";
import { itemsToMessages, type TurnItem } from "./useAgentStream";

function user(content: string): TurnItem {
  return { kind: "user", id: `u-${content.slice(0, 8)}`, content };
}

function assistant(content: string): TurnItem {
  return { kind: "assistant", id: `a-${content.slice(0, 8)}`, content, isStreaming: false };
}

function tool(
  callId: string,
  name: string,
  status: "result" | "error" | "rejected" | "pending" | "approved",
  opts: { input?: unknown; result?: unknown; error?: string } = {}
): TurnItem {
  return {
    kind: "tool",
    id: `t-${callId}`,
    callId,
    toolName: name,
    input: opts.input ?? {},
    requiredPermission: "Read",
    status,
    result: opts.result,
    error: opts.error,
  };
}

describe("itemsToMessages", () => {
  it("replays a harness-seeded (auto) tool item as an assistant tool_call + tool result, flag dropped", () => {
    const seeded: TurnItem = {
      ...(tool("call_auto_1", "mcp_cre-agents__discover_tasks", "result", {
        input: { request: "underwrite", environment: "excel" },
        result: '{"candidates":[]}',
      }) as Extract<TurnItem, { kind: "tool" }>),
      auto: true,
    };
    const msgs = itemsToMessages([user("underwrite"), seeded]);
    expect(msgs).toEqual([
      { role: "user", content: "underwrite" },
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call_auto_1",
            type: "function",
            function: {
              name: "mcp_cre-agents__discover_tasks",
              arguments: JSON.stringify({ request: "underwrite", environment: "excel" }),
            },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_auto_1", content: '{"candidates":[]}' },
    ]);
    expect(JSON.stringify(msgs)).not.toContain('auto"');
  });

  it("preserves user + assistant text turns", () => {
    const items: TurnItem[] = [user("hi"), assistant("hello!")];
    expect(itemsToMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
    ]);
  });

  it("attaches tool_calls to the preceding assistant message and emits tool result messages", () => {
    const items: TurnItem[] = [
      user("read A1"),
      assistant("I'll read it."),
      tool("c1", "read_range", "result", {
        input: { sheetName: "Sheet1", address: "A1" },
        result: { value: 42 },
      }),
      assistant("The value is 42."),
    ];

    const msgs = itemsToMessages(items);
    expect(msgs).toHaveLength(4);

    const assistantMsg = msgs[1];
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.content).toBe("I'll read it.");
    expect(assistantMsg.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: {
          name: "read_range",
          arguments: JSON.stringify({ sheetName: "Sheet1", address: "A1" }),
        },
      },
    ]);

    expect(msgs[2]).toEqual({
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({ value: 42 }),
    });

    expect(msgs[3]).toEqual({ role: "assistant", content: "The value is 42." });
  });

  it("batches multiple tool calls under one assistant message", () => {
    const items: TurnItem[] = [
      user("read both"),
      assistant("Reading."),
      tool("c1", "read_range", "result", { result: "a" }),
      tool("c2", "read_range", "result", { result: "b" }),
      assistant("Done."),
    ];

    const msgs = itemsToMessages(items);
    const asst = msgs[1];
    expect(asst.tool_calls).toHaveLength(2);
    expect(asst.tool_calls?.[0].id).toBe("c1");
    expect(asst.tool_calls?.[1].id).toBe("c2");

    // Two tool messages follow the assistant, in order.
    expect(msgs[2]).toMatchObject({ role: "tool", tool_call_id: "c1" });
    expect(msgs[3]).toMatchObject({ role: "tool", tool_call_id: "c2" });

    // The final assistant is a SEPARATE message (not the same one with more
    // tool calls appended).
    expect(msgs[4]).toEqual({ role: "assistant", content: "Done." });
  });

  it("emits an error tool message for failed tools (preserves the error text)", () => {
    const items: TurnItem[] = [
      user("write"),
      assistant("Writing."),
      tool("c1", "write_range", "error", {
        input: { sheetName: "S", address: "A1" },
        error: "Range out of bounds",
      }),
    ];
    const msgs = itemsToMessages(items);
    const toolMsg = msgs[2];
    expect(toolMsg.role).toBe("tool");
    expect(toolMsg.content).toBe(JSON.stringify({ error: "Range out of bounds" }));
  });

  it("emits a denial tool message for user-rejected writes", () => {
    const items: TurnItem[] = [
      user("write"),
      assistant("Writing."),
      tool("c1", "write_range", "rejected"),
    ];
    const msgs = itemsToMessages(items);
    expect(msgs[2]).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
      content: JSON.stringify({ error: "User denied this write." }),
    });
  });

  it("skips pending and approved tools (mid-flight, no terminal result yet)", () => {
    const items: TurnItem[] = [
      user("go"),
      assistant("Working."),
      tool("c1", "read_range", "pending"),
      tool("c2", "read_range", "approved"),
    ];
    const msgs = itemsToMessages(items);
    // Just user + assistant — no tool_calls attached, no tool result messages.
    expect(msgs).toEqual([
      { role: "user", content: "go" },
      { role: "assistant", content: "Working." },
    ]);
  });

  it("synthesizes an empty assistant message when a tool call lands with no preceding assistant text", () => {
    const items: TurnItem[] = [user("just go"), tool("c1", "read_range", "result", { result: 1 })];
    const msgs = itemsToMessages(items);
    // user, synthesized empty assistant with tool_call, tool result
    expect(msgs).toHaveLength(3);
    expect(msgs[1]).toEqual({
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: "c1",
          type: "function",
          function: { name: "read_range", arguments: "{}" },
        },
      ],
    });
    expect(msgs[2]).toMatchObject({ role: "tool", tool_call_id: "c1" });
  });

  it("skips empty assistant items (placeholders that never streamed content)", () => {
    const items: TurnItem[] = [user("hi"), assistant(""), assistant("real reply")];
    const msgs = itemsToMessages(items);
    expect(msgs).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "real reply" },
    ]);
  });

  it("skips system notices (UI-only — never sent to the model)", () => {
    const items: TurnItem[] = [
      user("hi"),
      { kind: "system", id: "s1", title: "Switched to Plan mode" },
      assistant("hello!"),
    ];
    expect(itemsToMessages(items)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello!" },
    ]);
  });

  it("replays plan items as a submit_plan tool call + result so the model sees them as tools, not synthetic text", () => {
    const items: TurnItem[] = [
      user("build something"),
      assistant("Here's my plan:"),
      {
        kind: "plan",
        id: "p1",
        callId: "c1",
        planId: "plan-1",
        steps: [
          { number: 1, title: "Read A1", status: "done" },
          { number: 2, title: "Write B2", status: "in-progress" },
        ],
      },
    ];

    const msgs = itemsToMessages(items);
    expect(msgs).toHaveLength(3);

    // The assistant message has a submit_plan tool_call.
    const asst = msgs[1];
    expect(asst.role).toBe("assistant");
    expect(asst.tool_calls).toEqual([
      {
        id: "c1",
        type: "function",
        function: {
          name: "submit_plan",
          arguments: JSON.stringify({
            steps: [
              { number: 1, title: "Read A1", details: undefined },
              { number: 2, title: "Write B2", details: undefined },
            ],
          }),
        },
      },
    ]);

    // Followed by a tool message with the plan result (current step statuses).
    expect(msgs[2]).toMatchObject({
      role: "tool",
      tool_call_id: "c1",
    });
    const toolContent = JSON.parse(msgs[2].content as string);
    expect(toolContent.planId).toBe("plan-1");
    expect(toolContent.steps).toHaveLength(2);
  });

  it("multi-turn: assistant → tool → assistant → tool → assistant produces correct message sequence", () => {
    const items: TurnItem[] = [
      user("go"),
      assistant("first read"),
      tool("c1", "read_range", "result", { result: "a" }),
      assistant("second read"),
      tool("c2", "read_range", "result", { result: "b" }),
      assistant("done"),
    ];

    const msgs = itemsToMessages(items);
    expect(msgs.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
      "assistant",
    ]);
    // Each non-final assistant has exactly one tool_call.
    expect(msgs[1].tool_calls).toHaveLength(1);
    expect(msgs[3].tool_calls).toHaveLength(1);
    // The final assistant has none.
    expect(msgs[5].tool_calls).toBeUndefined();
  });
});

describe("itemsToMessages — selection metadata", () => {
  it("replays a user item's selection as the bracketed note", () => {
    const items: TurnItem[] = [
      {
        kind: "user",
        id: "u-sel",
        content: "fix this",
        selection: { sheetName: "Q3 Model", address: "D12:D40" },
      },
      { kind: "assistant", id: "a-1", content: "done", isStreaming: false },
    ];
    const messages = itemsToMessages(items);
    expect(messages[0].role).toBe("user");
    expect(messages[0].content).toBe(
      "fix this\n\n[User's Excel selection when this message was sent: 'Q3 Model'!D12:D40]"
    );
  });

  it("leaves selection-less user items untouched", () => {
    const items: TurnItem[] = [{ kind: "user", id: "u-1", content: "plain" }];
    expect(itemsToMessages(items)).toEqual([{ role: "user", content: "plain" }]);
  });

  it("a steering user item between tool batches resets attachment like any user turn", () => {
    const items: TurnItem[] = [
      { kind: "user", id: "u-1", content: "start" },
      { kind: "assistant", id: "a-1", content: "reading", isStreaming: false },
      {
        kind: "tool",
        id: "t-c1",
        callId: "c1",
        toolName: "read_x",
        input: {},
        requiredPermission: "Read",
        status: "result",
        result: { ok: true },
      },
      // Steering message delivered at the boundary.
      { kind: "user", id: "u-steer", content: "use the 2025 tab" },
      { kind: "assistant", id: "a-2", content: "switched", isStreaming: false },
    ];
    const messages = itemsToMessages(items);
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "user", "assistant"]);
    // The tool_call attached to the pre-steering assistant, not the later one.
    const withCalls = messages.filter((m) => m.role === "assistant" && m.tool_calls);
    expect(withCalls).toHaveLength(1);
    expect(withCalls[0].content).toBe("reading");
  });
});

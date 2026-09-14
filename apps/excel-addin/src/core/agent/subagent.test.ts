import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, OpenRouterClient } from "../openrouter";
import { OpenRouterError } from "../openrouter";
import { inMemoryDataSource } from "../context";
import { createToolRegistry, createUndoStack, spawnSubagentTool, type ToolDef } from "../tools";
import { createOrchestrator } from "./orchestrator";
import { runSubagent } from "./subagent";

function stubClient(turns: ChatEvent[][]): OpenRouterClient {
  let i = 0;
  return {
    async *chat() {
      if (i >= turns.length) throw new Error("ran out of scripted turns");
      for (const event of turns[i++]) yield event;
    },
    async listModels() {
      return [];
    },
  };
}

function fakeReadTool<I, O>(name: string, output: O, spy?: (input: I) => void): ToolDef<I, O> {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: "object", properties: {} },
    requiredPermission: "Read",
    async execute(input) {
      spy?.(input);
      return output;
    },
  };
}

describe("runSubagent", () => {
  it("runs a child orchestrator with the given prompt and returns the assistant text", async () => {
    const client = stubClient([
      [
        { type: "text-delta", text: "Hello " },
        { type: "text-delta", text: "child!" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const registry = createToolRegistry([]);
    const result = await runSubagent(
      {
        client,
        registry,
        ds,
        undoStack: createUndoStack(),
        onApprovalRequest: vi.fn().mockResolvedValue("deny"),
      },
      { apiKey: "k", modelId: "x" },
      { prompt: "Greet me" }
    );

    expect(result.summary).toBe("Hello child!");
    expect(result.turns).toBe(0); // no tool calls
  });

  it("aggregates cost across usage events", async () => {
    const client = stubClient([
      [
        {
          type: "usage",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0.0007 },
        },
        { type: "text-delta", text: "done" },
        {
          type: "usage",
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cost: 0.0003 },
        },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const result = await runSubagent(
      {
        client,
        registry: createToolRegistry([]),
        ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
        undoStack: createUndoStack(),
        onApprovalRequest: vi.fn(),
      },
      { apiKey: "k", modelId: "x" },
      { prompt: "go" }
    );
    expect(result.cost).toBeCloseTo(0.001);
  });

  it("counts tool calls as turns", async () => {
    const spy = vi.fn();
    const tool = fakeReadTool("read_range", { ok: true }, spy);
    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_range" },
        { type: "tool-call-delta", index: 0, argumentsDelta: "{}" },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Done." },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const result = await runSubagent(
      {
        client,
        registry: createToolRegistry([tool]),
        ds: inMemoryDataSource({ sheets: [{ name: "S" }] }),
        undoStack: createUndoStack(),
        onApprovalRequest: vi.fn(),
      },
      { apiKey: "k", modelId: "x" },
      { prompt: "go", toolAllowlist: ["read_range"] }
    );
    expect(spy).toHaveBeenCalled();
    expect(result.turns).toBe(1);
    expect(result.summary).toBe("Done.");
  });

  it("respects subOpts.maxTurns to cap runaway loops", async () => {
    const tool = fakeReadTool("read_range", { ok: true });
    const loop: ChatEvent[] = [
      { type: "tool-call-start", index: 0, id: "c", name: "read_range" },
      { type: "tool-call-delta", index: 0, argumentsDelta: "{}" },
      { type: "done", finishReason: "tool_calls" },
    ];
    const client = stubClient([loop, loop, loop, loop]);

    const result = await runSubagent(
      {
        client,
        registry: createToolRegistry([tool]),
        ds: inMemoryDataSource({ sheets: [{ name: "S" }] }),
        undoStack: createUndoStack(),
        onApprovalRequest: vi.fn(),
      },
      { apiKey: "k", modelId: "x" },
      { prompt: "loop forever", maxTurns: 2 }
    );
    // maxTurns is 2 -> tool runs 2 times -> done with length reason
    expect(result.turns).toBe(2);
  });
});

describe("runSubagent — integration with orchestrator", () => {
  it("parent orchestrator can spawn a sub-agent via the spawn_subagent tool", async () => {
    const ds = inMemoryDataSource({ sheets: [{ name: "Sheet1" }] });
    const undoStack = createUndoStack();
    const registry = createToolRegistry([spawnSubagentTool]);

    // The parent calls spawn_subagent. The child stub yields a greeting.
    const childTurns: ChatEvent[][] = [
      [
        { type: "text-delta", text: "Child finished work." },
        { type: "done", finishReason: "stop" },
      ],
    ];
    // The parent's chat() emits: tool-call for spawn_subagent, then text wrap.
    const parentTurns: ChatEvent[][] = [
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "spawn_subagent" },
        {
          type: "tool-call-delta",
          index: 0,
          argumentsDelta: JSON.stringify({ type: "Explore", task: "do analysis" }),
        },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Parent says: " },
        { type: "text-delta", text: "child reported back." },
        { type: "done", finishReason: "stop" },
      ],
    ];

    // Build a single client that serves parent turns first, then child turns.
    const allTurns = [parentTurns[0], childTurns[0], parentTurns[1]];
    let idx = 0;
    const client: OpenRouterClient = {
      async *chat() {
        for (const e of allTurns[idx++]) yield e;
      },
      async listModels() {
        return [];
      },
    };

    const orch = createOrchestrator({
      client,
      registry,
      ds,
      undoStack,
      onApprovalRequest: vi.fn(),
    });

    const events: { type: string }[] = [];
    for await (const e of orch.run({
      apiKey: "k",
      modelId: "x",
      messages: [{ role: "user", content: "go" }],
    })) {
      events.push({ type: e.type });
    }

    // Verify the spawn_subagent tool ran and yielded a result
    const types = events.map((e) => e.type);
    expect(types).toContain("tool-call-pending");
    expect(types).toContain("tool-call-result");
  });

  it("drops the partial output of a failed attempt when the child retries", async () => {
    let attempts = 0;
    const client: OpenRouterClient = {
      async *chat() {
        attempts++;
        if (attempts === 1) {
          yield { type: "text-delta", text: "half-" };
          throw new OpenRouterError(503, "upstream down");
        }
        yield { type: "text-delta", text: "whole answer" };
        yield { type: "done", finishReason: "stop" };
      },
      async listModels() {
        return [];
      },
    };

    const result = await runSubagent(
      {
        client,
        registry: createToolRegistry([]),
        ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
        undoStack: createUndoStack(),
        onApprovalRequest: vi.fn().mockResolvedValue("deny"),
        sleep: async () => {},
      },
      { apiKey: "k", modelId: "x" },
      { prompt: "Summarize" }
    );

    expect(attempts).toBe(2);
    expect(result.summary).toBe("whole answer");
  });
});

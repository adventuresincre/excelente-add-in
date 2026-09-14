import { describe, expect, it, vi } from "vitest";
import type { ChatEvent, ChatMessage, OpenRouterClient } from "../openrouter";
import { OpenRouterError } from "../openrouter";
import { inMemoryDataSource } from "../context";
import { createToolRegistry, createUndoStack, type ToolDef } from "../tools";
import { createHookRegistry } from "../hooks";
import { createOrchestrator, type AgentEvent } from "./orchestrator";
import { createSteeringQueue } from "./steering";

/** Build a stub OpenRouter client that yields scripted event sequences. */
function stubClient(turns: ChatEvent[][]): OpenRouterClient {
  let turn = 0;
  return {
    async *chat() {
      if (turn >= turns.length) {
        throw new Error("stubClient: ran out of scripted turns");
      }
      const events = turns[turn++];
      for (const e of events) yield e;
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

function fakeWriteTool<I>(name: string, spy?: (input: I) => void): ToolDef<I, string> {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: "object", properties: {} },
    requiredPermission: "Write",
    async execute(input) {
      spy?.(input);
      return "ok";
    },
  };
}

async function collect(stream: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

const baseDeps = (client: OpenRouterClient, tools: ToolDef[], onApprovalRequest = vi.fn()) => ({
  client,
  registry: createToolRegistry(tools),
  ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
  undoStack: createUndoStack(),
  onApprovalRequest,
  // Skip the real retry backoff so the retry ladder is exercised without
  // the suite paying its wall-clock cost.
  sleep: async () => {},
});

describe("orchestrator.run — transient stream failures", () => {
  /** Client that throws `failures` times before serving the scripted turns. */
  function flakyClient(
    failures: number,
    error: unknown,
    turns: ChatEvent[][]
  ): { client: OpenRouterClient; attempts: () => number } {
    let attempts = 0;
    let turn = 0;
    return {
      attempts: () => attempts,
      client: {
        async *chat() {
          attempts++;
          if (attempts <= failures) throw error;
          const events = turns[turn++];
          for (const e of events) yield e;
        },
        async listModels() {
          return [];
        },
      },
    };
  }

  it("retries a 429 and completes the run", async () => {
    const { client, attempts } = flakyClient(
      2,
      new OpenRouterError(429, '{"error":"rate limited"}'),
      [
        [
          { type: "text-delta", text: "recovered" },
          { type: "done", finishReason: "stop" },
        ],
      ]
    );

    const events = await collect(
      createOrchestrator(baseDeps(client, [])).run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    expect(attempts()).toBe(3);
    const retries = events.filter((e) => e.type === "stream-retry");
    expect(retries).toHaveLength(2);
    expect(events.some((e) => e.type === "text-delta" && e.text === "recovered")).toBe(true);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("does not retry a non-transient error (401)", async () => {
    const { client, attempts } = flakyClient(1, new OpenRouterError(401, "bad key"), [
      [{ type: "done", finishReason: "stop" }],
    ]);

    await expect(
      collect(
        createOrchestrator(baseDeps(client, [])).run({
          apiKey: "k",
          modelId: "x",
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toThrow(/401/);
    expect(attempts()).toBe(1);
  });

  it("gives up after the retry ceiling and surfaces the error", async () => {
    const { client, attempts } = flakyClient(99, new OpenRouterError(503, "upstream down"), [
      [{ type: "done", finishReason: "stop" }],
    ]);

    await expect(
      collect(
        createOrchestrator(baseDeps(client, [])).run({
          apiKey: "k",
          modelId: "x",
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toThrow(/503/);
    // Initial attempt + MAX_STREAM_RETRIES.
    expect(attempts()).toBe(6);
  });

  it("retries after partial output and tells the consumer exactly what to discard", async () => {
    // The reported failure: a free NVIDIA model streamed reasoning and text,
    // then the shared worker pool hit its ceiling mid-answer. The retry
    // replays the turn from scratch, so the consumer has to be told how much
    // of the failed attempt it already rendered.
    let attempts = 0;
    const client: OpenRouterClient = {
      async *chat() {
        attempts++;
        if (attempts === 1) {
          yield { type: "reasoning-delta", text: "hmm" };
          yield { type: "text-delta", text: "partial " };
          throw new OpenRouterError(
            429,
            '{"error":{"message":"Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (16/16)"}}'
          );
        }
        yield { type: "text-delta", text: "whole answer" };
        yield { type: "done", finishReason: "stop" };
      },
      async listModels() {
        return [];
      },
    };

    const events = await collect(
      createOrchestrator(baseDeps(client, [])).run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    expect(attempts).toBe(2);
    const retry = events.find((e) => e.type === "stream-retry");
    expect(retry).toMatchObject({
      type: "stream-retry",
      attempt: 1,
      reason: "capacity",
      discard: { text: "partial ".length, reasoning: "hmm".length },
    });
    const text = events.flatMap((e) => (e.type === "text-delta" ? [e.text] : []));
    expect(text).toEqual(["partial ", "whole answer"]);
    expect(events.at(-1)).toEqual({ type: "done", finishReason: "stop" });
  });

  it("omits discard when nothing had streamed", async () => {
    const { client } = flakyClient(1, new OpenRouterError(503, "upstream down"), [
      [{ type: "done", finishReason: "stop" }],
    ]);

    const events = await collect(
      createOrchestrator(baseDeps(client, [])).run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    const retry = events.find((e) => e.type === "stream-retry");
    expect(retry).toMatchObject({ type: "stream-retry", reason: "provider" });
    expect(retry).not.toHaveProperty("discard");
  });

  it("does not retry once usage has been reported — the turn was billed", async () => {
    let attempts = 0;
    const client: OpenRouterClient = {
      async *chat() {
        attempts++;
        yield { type: "text-delta", text: "done answer" };
        yield { type: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } };
        throw new OpenRouterError(500, "died after usage");
      },
      async listModels() {
        return [];
      },
    };

    await expect(
      collect(
        createOrchestrator(baseDeps(client, [])).run({
          apiKey: "k",
          modelId: "x",
          messages: [{ role: "user", content: "hi" }],
        })
      )
    ).rejects.toThrow(/500/);
    expect(attempts).toBe(1);
  });
});

describe("orchestrator.run", () => {
  it("ends after a single text turn with no tool calls", async () => {
    const client = stubClient([
      [
        { type: "text-delta", text: "Hello" },
        { type: "text-delta", text: " world" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const orch = createOrchestrator(baseDeps(client, []));

    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    expect(events).toEqual([
      { type: "text-delta", text: "Hello" },
      { type: "text-delta", text: " world" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("executes a read tool and loops to a second model turn", async () => {
    const readSpy = vi.fn();
    const tool = fakeReadTool("read_x", { value: 42 }, readSpy);

    const client = stubClient([
      // Turn 1: model emits one tool call
      [
        {
          type: "tool-call-start",
          index: 0,
          id: "call_1",
          name: "read_x",
        },
        {
          type: "tool-call-delta",
          index: 0,
          argumentsDelta: `{"q":"v"}`,
        },
        { type: "done", finishReason: "tool_calls" },
      ],
      // Turn 2: model wraps up
      [
        { type: "text-delta", text: "Answer based on tool" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool]));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
      })
    );

    expect(readSpy).toHaveBeenCalledWith({ q: "v" });
    expect(events.map((e) => e.type)).toEqual([
      "tool-call-pending",
      "tool-call-approved", // read tools auto-approve
      "tool-call-result",
      "text-delta",
      "done",
    ]);
  });

  it("gates write tools through onApprovalRequest", async () => {
    const writeSpy = vi.fn();
    const tool = fakeWriteTool("write_x", writeSpy);
    const onApprovalRequest = vi.fn().mockResolvedValue("approve");

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "write_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool], onApprovalRequest));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );

    expect(onApprovalRequest).toHaveBeenCalledOnce();
    expect(writeSpy).toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("tool-call-pending");
    expect(events.map((e) => e.type)).toContain("tool-call-approved");
    expect(events.map((e) => e.type)).toContain("tool-call-result");
  });

  it("skips the write when the user denies", async () => {
    const writeSpy = vi.fn();
    const tool = fakeWriteTool("write_x", writeSpy);
    const onApprovalRequest = vi.fn().mockResolvedValue("deny");

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "write_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool], onApprovalRequest));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );

    expect(writeSpy).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("tool-call-rejected");
  });

  it("approve-all skips further approval prompts in this run", async () => {
    const tool = fakeWriteTool("write_x");
    const onApprovalRequest = vi.fn().mockResolvedValue("approve-all");

    const client = stubClient([
      // Turn 1: two write calls
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "write_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "tool-call-start", index: 1, id: "c2", name: "write_x" },
        { type: "tool-call-delta", index: 1, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      // Turn 2: another write call -- should also skip prompt
      [
        { type: "tool-call-start", index: 0, id: "c3", name: "write_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool], onApprovalRequest));
    await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );

    // First call asks; subsequent calls auto-approve.
    expect(onApprovalRequest).toHaveBeenCalledOnce();
  });

  it("emits tool-call-error for unknown tools", async () => {
    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "does_not_exist" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "sorry" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, []));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );
    const error = events.find((e) => e.type === "tool-call-error");
    expect(error).toBeDefined();
    if (error?.type === "tool-call-error") {
      expect(error.error).toContain("Unknown tool");
    }
  });

  // The registry is shared process-wide, so filtering the advertised tool
  // list is not a boundary on its own — the model can still name anything.
  // Sub-agent roles, plan mode, and connector gating all rely on the
  // orchestrator refusing to dispatch off-list names.
  it("refuses to dispatch a registered tool that is not in toolAllowlist", async () => {
    const offListSpy = vi.fn();
    const allowed = fakeReadTool("read_allowed", { ok: true });
    const offList = fakeWriteTool("write_secret", offListSpy);

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "write_secret" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const approvalSpy = vi.fn(async () => "approve" as const);
    const deps = { ...baseDeps(client, [allowed, offList]), onApprovalRequest: approvalSpy };
    const events = await collect(
      createOrchestrator(deps).run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
        toolAllowlist: ["read_allowed"],
      })
    );

    expect(offListSpy).not.toHaveBeenCalled();
    // Never even reaches the approval gate — it is not dispatchable at all.
    expect(approvalSpy).not.toHaveBeenCalled();
    const error = events.find((e) => e.type === "tool-call-error");
    expect(error?.type).toBe("tool-call-error");
    if (error?.type === "tool-call-error") {
      expect(error.error).toContain("not available in this run");
    }
  });

  it("still dispatches tools that are in toolAllowlist", async () => {
    const spy = vi.fn();
    const tool = fakeReadTool("read_allowed", { rows: 1 }, spy);
    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_allowed" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const events = await collect(
      createOrchestrator(baseDeps(client, [tool])).run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
        toolAllowlist: ["read_allowed"],
      })
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(events.some((e) => e.type === "tool-call-result")).toBe(true);
  });

  it("emits tool-call-error for invalid JSON arguments", async () => {
    const tool = fakeReadTool("read_x", {});
    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{not valid` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const orch = createOrchestrator(baseDeps(client, [tool]));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );
    const error = events.find((e) => e.type === "tool-call-error");
    expect(error?.type).toBe("tool-call-error");
    if (error?.type === "tool-call-error") {
      expect(error.error).toContain("Invalid JSON");
    }
  });

  it("denies Write tools at a Read session without prompting the user", async () => {
    const writeSpy = vi.fn();
    const tool = fakeWriteTool("write_x", writeSpy);
    const onApprovalRequest = vi.fn();

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "write_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "Can't write here." },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool], onApprovalRequest));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "do it" }],
        sessionPermission: "Read",
      })
    );

    // Tool was rejected, never executed, and approval was never requested.
    expect(writeSpy).not.toHaveBeenCalled();
    expect(onApprovalRequest).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("tool-call-rejected");
    // The model gets a second turn after seeing the denial, so it can adapt.
    expect(events.map((e) => e.type)).toContain("text-delta");
  });

  it("Read tools run freely at a Read session (no approval, no denial)", async () => {
    const readSpy = vi.fn();
    const tool = fakeReadTool("read_x", { value: 1 }, readSpy);
    const onApprovalRequest = vi.fn();

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "done" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [tool], onApprovalRequest));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "go" }],
        sessionPermission: "Read",
      })
    );

    expect(readSpy).toHaveBeenCalled();
    expect(onApprovalRequest).not.toHaveBeenCalled();
    expect(events.map((e) => e.type)).toContain("tool-call-result");
  });

  it("emits permission-changed when a tool calls setSessionPermission, and applies the new perm to subsequent calls", async () => {
    // A tool that flips session permission to Read on first call.
    const planModeTool: ToolDef<Record<string, never>, { ok: true }> = {
      name: "enter_plan_mode",
      description: "test",
      inputSchema: { type: "object", properties: {} },
      requiredPermission: "Read",
      async execute(_input, ctx) {
        ctx.setSessionPermission?.("Read");
        return { ok: true };
      },
    };
    const writeTool = fakeWriteTool("write_x");
    const onApprovalRequest = vi.fn();

    const client = stubClient([
      // Turn 1: enter_plan_mode + a write attempt in the same turn.
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "enter_plan_mode" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "tool-call-start", index: 1, id: "c2", name: "write_x" },
        { type: "tool-call-delta", index: 1, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "stopped" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [planModeTool, writeTool], onApprovalRequest));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "go" }] })
    );

    // The mode-change event lands after the plan-mode tool's result.
    const types = events.map((e) => e.type);
    const planIdx = types.indexOf("tool-call-result");
    const modeIdx = types.indexOf("permission-changed");
    expect(modeIdx).toBeGreaterThan(planIdx);

    // The write tool, dispatched after enter_plan_mode in the same turn, is
    // denied without prompting because the session is now Read.
    expect(types).toContain("tool-call-rejected");
    expect(onApprovalRequest).not.toHaveBeenCalled();
  });

  it("PreToolUse hook can veto a tool call, surfacing tool-call-error without prompting or executing", async () => {
    const readSpy = vi.fn();
    const tool = fakeReadTool("read_x", { ok: true }, readSpy);
    const hooks = createHookRegistry();
    hooks.on("PreToolUse", async (ctx) => {
      if (ctx.event === "PreToolUse" && ctx.toolName === "read_x") {
        return { veto: "test guard" };
      }
    });

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: "{}" },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const orch = createOrchestrator({ ...baseDeps(client, [tool]), hooks });
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "go" }] })
    );

    expect(readSpy).not.toHaveBeenCalled();
    const err = events.find((e) => e.type === "tool-call-error");
    expect(err).toBeDefined();
    if (err?.type === "tool-call-error") {
      expect(err.error).toMatch(/test guard/);
      expect(err.error).toMatch(/read_x/);
    }
  });

  it("PostToolUse hook fires for both success and error paths", async () => {
    const tool = fakeReadTool("read_x", { ok: true });
    const hooks = createHookRegistry();
    const post = vi.fn();
    hooks.on("PostToolUse", post);

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: "{}" },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);
    const orch = createOrchestrator({ ...baseDeps(client, [tool]), hooks });
    await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "go" }] })
    );

    expect(post).toHaveBeenCalledOnce();
    expect(post.mock.calls[0][0]).toMatchObject({
      event: "PostToolUse",
      toolName: "read_x",
      result: { ok: true },
    });
  });

  it("emits requiredPermission on tool-call-pending events", async () => {
    const readTool = fakeReadTool("read_x", {});
    const writeTool = fakeWriteTool("write_x");
    const onApprovalRequest = vi.fn().mockResolvedValue("approve");

    const client = stubClient([
      [
        { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
        { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
        { type: "tool-call-start", index: 1, id: "c2", name: "write_x" },
        { type: "tool-call-delta", index: 1, argumentsDelta: `{}` },
        { type: "done", finishReason: "tool_calls" },
      ],
      [
        { type: "text-delta", text: "ok" },
        { type: "done", finishReason: "stop" },
      ],
    ]);

    const orch = createOrchestrator(baseDeps(client, [readTool, writeTool], onApprovalRequest));
    const events = await collect(
      orch.run({ apiKey: "k", modelId: "x", messages: [{ role: "user", content: "hi" }] })
    );

    const pending = events.filter((e) => e.type === "tool-call-pending");
    expect(pending).toHaveLength(2);
    expect(pending.map((e) => e.type === "tool-call-pending" && e.requiredPermission)).toEqual([
      "Read",
      "Write",
    ]);
  });

  it("caps runaway tool loops at maxTurns", async () => {
    const tool = fakeReadTool("read_x", {});
    // Every turn the model emits one tool call -> would loop forever
    const turn: ChatEvent[] = [
      { type: "tool-call-start", index: 0, id: "c", name: "read_x" },
      { type: "tool-call-delta", index: 0, argumentsDelta: `{}` },
      { type: "done", finishReason: "tool_calls" },
    ];
    const client = stubClient([turn, turn, turn]);

    const orch = createOrchestrator(baseDeps(client, [tool]));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "x",
        messages: [{ role: "user", content: "hi" }],
        maxTurns: 3,
      })
    );
    const done = events.find((e) => e.type === "done");
    if (done?.type === "done") {
      // Distinct from the model's own "length" output-truncation reason —
      // "max-turns" tells the UI to surface the Continue Working button.
      expect(done.finishReason).toBe("max-turns");
    }
  });
});

describe("orchestrator.run — mid-run steering", () => {
  /** Client that records the messages array of every chat() call. */
  function recordingClient(script: (call: number) => ChatEvent[]): {
    client: OpenRouterClient;
    calls: ChatMessage[][];
  } {
    const calls: ChatMessage[][] = [];
    return {
      calls,
      client: {
        async *chat(opts: { messages: ChatMessage[] }) {
          calls.push([...opts.messages]);
          for (const e of script(calls.length)) yield e;
        },
        async listModels() {
          return [];
        },
      } as OpenRouterClient,
    };
  }

  it("delivers a message queued during a tool at the boundary, before the next model call", async () => {
    const steering = createSteeringQueue();
    // Simulate the user typing while the tool executes: the tool itself
    // posts into the queue.
    const tool = fakeReadTool("read_x", { ok: true }, () => {
      steering.post({ id: "s1", text: "use the 2025 tab" });
    });
    const { client, calls } = recordingClient((call) =>
      call === 1
        ? [
            { type: "tool-call-start", index: 0, id: "c1", name: "read_x" },
            { type: "tool-call-delta", index: 0, argumentsDelta: "{}" },
            { type: "done", finishReason: "tool_calls" },
          ]
        : [
            { type: "text-delta", text: "switched to 2025" },
            { type: "done", finishReason: "stop" },
          ]
    );

    const orch = createOrchestrator(baseDeps(client, [tool]));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "m",
        messages: [{ role: "user", content: "sum the tab" }],
        steering,
      })
    );

    // Event ordering: result lands before delivery, delivery before the
    // next turn's text.
    const resultIdx = events.findIndex((e) => e.type === "tool-call-result");
    const deliveredIdx = events.findIndex((e) => e.type === "steering-delivered");
    const textIdx = events.findIndex((e) => e.type === "text-delta");
    expect(resultIdx).toBeGreaterThanOrEqual(0);
    expect(deliveredIdx).toBeGreaterThan(resultIdx);
    expect(textIdx).toBeGreaterThan(deliveredIdx);
    const delivered = events[deliveredIdx] as Extract<AgentEvent, { type: "steering-delivered" }>;
    expect(delivered.id).toBe("s1");
    expect(delivered.text).toBe("use the 2025 tab");

    // Wire ordering: [.., assistant(tool_calls), tool result, user steering]
    // — the user message lands after the batch, never inside it.
    const second = calls[1];
    const tail = second.slice(-3);
    expect(tail[0].role).toBe("assistant");
    expect(tail[1].role).toBe("tool");
    expect(tail[2]).toMatchObject({ role: "user", content: "use the 2025 tab" });
  });

  it("continues the run when the model stops while a message is queued", async () => {
    const steering = createSteeringQueue();
    const calls: ChatMessage[][] = [];
    const client: OpenRouterClient = {
      async *chat(opts: { messages: ChatMessage[] }) {
        calls.push([...opts.messages]);
        if (calls.length === 1) {
          yield { type: "text-delta", text: "first answer" } as ChatEvent;
          // User types while the final response is still streaming.
          steering.post({
            id: "s2",
            text: "also add totals",
            selection: { sheetName: "Q3 Model", address: "D12:D40" },
          });
          yield { type: "done", finishReason: "stop" } as ChatEvent;
        } else {
          yield { type: "text-delta", text: "totals added" } as ChatEvent;
          yield { type: "done", finishReason: "stop" } as ChatEvent;
        }
      },
      async listModels() {
        return [];
      },
    } as OpenRouterClient;

    const orch = createOrchestrator(baseDeps(client, []));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "m",
        messages: [{ role: "user", content: "build it" }],
        steering,
      })
    );

    // Exactly one done — the first stop was absorbed by the pending message.
    expect(events.filter((e) => e.type === "done")).toHaveLength(1);
    expect(events.some((e) => e.type === "steering-delivered")).toBe(true);
    expect(calls).toHaveLength(2);

    // The second call sees assistant("first answer") then the steering
    // message with its selection note appended.
    const tail = calls[1].slice(-2);
    expect(tail[0]).toMatchObject({ role: "assistant", content: "first answer" });
    expect(tail[1].role).toBe("user");
    expect(tail[1].content).toContain("also add totals");
    expect(tail[1].content).toContain("'Q3 Model'!D12:D40");
  });

  it("ends normally when nothing is queued", async () => {
    const steering = createSteeringQueue();
    const { client, calls } = recordingClient(() => [
      { type: "text-delta", text: "done" },
      { type: "done", finishReason: "stop" },
    ]);
    const orch = createOrchestrator(baseDeps(client, []));
    const events = await collect(
      orch.run({
        apiKey: "k",
        modelId: "m",
        messages: [{ role: "user", content: "hi" }],
        steering,
      })
    );
    expect(calls).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: "done", finishReason: "stop" });
  });
});

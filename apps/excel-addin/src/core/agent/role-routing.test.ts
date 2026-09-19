import { describe, expect, it } from "vitest";
import type { ChatEvent, ChatRequest, OpenRouterClient } from "../openrouter";
import { inMemoryDataSource } from "../context";
import { createToolRegistry, createUndoStack, type ToolDef } from "../tools";
import { createOrchestrator, type AgentEvent } from "./orchestrator";

interface Seen {
  apiKey: string;
  model: string;
}

/** Records every chat request it serves, then finishes the turn. */
function recordingClient(label: string, log: Array<Seen & { via: string }>): OpenRouterClient {
  return {
    async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
      log.push({ via: label, apiKey: req.apiKey, model: req.model });
      yield { type: "text-delta", text: "done" };
      yield { type: "done", finishReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
}

/** A read tool that delegates straight to whatever the orchestrator wired up. */
function spawnTool(): ToolDef<{ prompt: string }, string> {
  return {
    name: "fake_spawn",
    description: "spawns a subagent",
    inputSchema: { type: "object", properties: {} },
    requiredPermission: "Read",
    async execute(_input, ctx) {
      const res = await ctx?.runSubagent?.({ prompt: "go", systemPrompt: "child" });
      return res?.summary ?? "no subagent";
    },
  };
}

/** Primary client: calls fake_spawn on turn 1, then stops on turn 2. */
function primaryCallingSpawn(label: string, log: Array<Seen & { via: string }>): OpenRouterClient {
  let turn = 0;
  return {
    async *chat(req: ChatRequest): AsyncIterable<ChatEvent> {
      log.push({ via: label, apiKey: req.apiKey, model: req.model });
      if (turn++ === 0) {
        yield { type: "tool-call-start", index: 0, id: "c1", name: "fake_spawn" };
        yield { type: "tool-call-delta", index: 0, argumentsDelta: "{}" };
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      yield { type: "text-delta", text: "finished" };
      yield { type: "done", finishReason: "stop" };
    },
    async listModels() {
      return [];
    },
  };
}

async function drain(stream: AsyncIterable<AgentEvent>): Promise<void> {
  for await (const _ of stream) {
    // events are irrelevant here; we assert on which client was called
  }
}

const PIN = "z-ai/glm-5.3-flash";

function run(opts: {
  roleClient?: OpenRouterClient;
  subagentModelId?: string;
  roleApiKey?: string;
  log: Array<Seen & { via: string }>;
}) {
  const primary = primaryCallingSpawn("primary", opts.log);
  return drain(
    createOrchestrator({
      client: primary,
      roleClient: opts.roleClient,
      registry: createToolRegistry([spawnTool()]),
      ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
      undoStack: createUndoStack(),
      onApprovalRequest: async () => "approve",
      sleep: async () => {},
    }).run({
      apiKey: "",
      roleApiKey: opts.roleApiKey,
      modelId: PIN,
      subagentModelId: opts.subagentModelId,
      messages: [{ role: "user", content: "hi" }],
    })
  );
}

/**
 * The hosted-tier asymmetry: `client` is the host's proxy (no credential,
 * model pinned server-side), so a role override sent there would be silently
 * replaced by the pin. These cases pin down who gets called with what.
 */
describe("orchestrator role routing", () => {
  it("sends a sub-agent WITH an override to roleClient on the role credential", async () => {
    const log: Array<Seen & { via: string }> = [];
    const byok = recordingClient("byok", log);
    await run({
      log,
      roleClient: byok,
      roleApiKey: "sk-or-user",
      subagentModelId: "anthropic/claude-opus-4-7",
    });

    const child = log.filter((c) => c.via === "byok");
    expect(child).toHaveLength(1);
    expect(child[0].model).toBe("anthropic/claude-opus-4-7");
    expect(child[0].apiKey).toBe("sk-or-user");
    // The primary loop never leaves A.CRE's client.
    expect(log.filter((c) => c.via === "primary").every((c) => c.model === PIN)).toBe(true);
    expect(log.filter((c) => c.via === "primary").every((c) => c.apiKey === "")).toBe(true);
  });

  it("keeps a sub-agent WITHOUT an override on the primary client and credential", async () => {
    const log: Array<Seen & { via: string }> = [];
    const byok = recordingClient("byok", log);
    await run({ log, roleClient: byok, roleApiKey: "sk-or-user" });

    expect(log.some((c) => c.via === "byok")).toBe(false);
    // Three primary calls: turn 1 (tool call), the child's turn, then turn 2.
    expect(log.filter((c) => c.via === "primary")).toHaveLength(3);
    expect(log.every((c) => c.model === PIN)).toBe(true);
  });

  // Default BYOK: one client, one key. roleClient is absent, so an override
  // must still work exactly as it did before this seam existed.
  it("honors an override on the primary client when there is no roleClient", async () => {
    const log: Array<Seen & { via: string }> = [];
    await run({ log, subagentModelId: "anthropic/claude-opus-4-7" });

    expect(log.some((c) => c.via === "byok")).toBe(false);
    expect(log.map((c) => c.model)).toEqual([PIN, "anthropic/claude-opus-4-7", PIN]);
  });

  it("falls back to the primary credential when roleApiKey is unset", async () => {
    const log: Array<Seen & { via: string }> = [];
    const byok = recordingClient("byok", log);
    await run({ log, roleClient: byok, subagentModelId: "anthropic/claude-opus-4-7" });

    expect(log.find((c) => c.via === "byok")?.apiKey).toBe("");
  });
});

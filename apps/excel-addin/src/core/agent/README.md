# core/agent

Agent orchestrator. The loop that turns a user message into tool calls, tool results, and a final response.

## Responsibility

- Run the chat-with-tools loop against `core/openrouter`
- Look up tools from `core/tools/registry`
- Gate write tools through the approval UI
- Track context-window budget and spawn sub-agents when needed
- Activate skills from `core/skills` (auto via description match, or manual via picker)

## Sub-agents

When a task would overflow the parent's context (e.g., indexing a 100k-formula workbook), the orchestrator calls the `spawn_subagent` tool. Sub-agents:

- Run their own isolated conversation
- Receive an allowlisted tool subset
- Have a hard context budget
- Return a structured summary to the parent
- May run in parallel (`Promise.all` over multiple OpenRouter calls)

## Public interface (planned, lands in Phase 3 / extended in Phase 5)

```ts
export interface Orchestrator {
  run(prompt: string, opts?: RunOptions): AsyncIterable<AgentEvent>;
  cancel(): void;
}
```

## Dependencies

- `core/openrouter` for model calls
- `core/tools` for tool definitions and execution
- `core/skills` for skill activation
- `core/context` for read-only workbook context

## Lands in

Phase 3 — Agent loop. Sub-agents added in Phase 5.

# core/openrouter

OpenRouter HTTP client. The only path from Excelente to any LLM.

## Phase 1 status

Implemented: `createOpenRouterClient` factory with `chat()` (streaming) and `listModels()` (cached). Reasoning passthrough via `reasoningParamFor`.

## Public interface

```ts
import { createOpenRouterClient } from "./core/openrouter";

const client = createOpenRouterClient();

// Streaming chat
for await (const event of client.chat({
  apiKey: "sk-or-…",
  model: "anthropic/claude-opus-4-7",
  messages: [{ role: "user", content: "Hello" }],
  reasoning: "medium",
})) {
  switch (event.type) {
    case "text-delta": /* render event.text */ break;
    case "reasoning-delta": /* render thinking */ break;
    case "tool-call-start": /* index, id, name */ break;
    case "tool-call-delta": /* append event.argumentsDelta */ break;
    case "usage": /* event.usage.cost, tokens */ break;
    case "done": /* finishReason */ break;
  }
}

// List models (cached 1h)
const models = await client.listModels("sk-or-…");
```

Exports: `createOpenRouterClient`, `OpenRouterError`, the reasoning helpers `reasoningParamFor` / `resolveEffort` / `effortLadder` / `reasoningStopsFor` / `reasoningIsMandatory`, and all the types from [`types.ts`](types.ts).

## Streaming format

Uses OpenAI-compatible SSE (`stream: true`). Each `data:` chunk is a JSON `chat.completion.chunk` shape. [`sse.ts`](sse.ts) is a minimal parser (~30 lines) — handles CRLF, comments, chunk boundaries, and the `[DONE]` sentinel. We do not pull in `eventsource-parser`.

## Reasoning mapping

OpenRouter unifies reasoning across providers under a single `reasoning` field, but
models disagree on whether it can be turned off, how many effort rungs they offer,
and what those rungs are called. [`reasoning.ts`](reasoning.ts) maps the four slider
stops onto each model's own ladder, read from `/models`.`reasoning` (captured as
`ModelInfo.reasoningPolicy`):

| Slider | Body |
|---|---|
| `off`    | `{ enabled: false }` when the model allows it; the model's **weakest rung** when `mandatory`; omitted when the policy is unknown |
| `low`    | the model's **weakest** rung (never `none`) |
| `medium` | the model's own `medium` → else its `default_effort` if strictly between the ends → else the ordinal middle, rounding weaker |
| `high`   | the model's **strongest** rung (`max` where it exists) |

The ladder is the provider's published `supported_efforts` order (strongest first
across the whole catalogue), so a rung name we have never seen still lands where its
lab ranks it. With no published ladder the level name passes through unchanged and
OpenRouter normalizes it. `reasoningStopsFor` tells the Settings slider which stops
collapse onto a neighbour on this model, and what each one is sent as.

OpenRouter routes `effort` to provider-native params (OpenAI `reasoning_effort`, Anthropic `thinking.budget_tokens`, Gemini `thinking_budget`).

## Headers

Every request sends:
- `Authorization: Bearer <key>`
- `HTTP-Referer: https://excelente.aiedge.ac`
- `X-Title: Excelente`

The last two power OpenRouter's per-app analytics + ranking.

## Errors

- Non-2xx HTTP → `OpenRouterError` (carries `status` and `responseBody`; the message keeps the provider's own text and any fix URL from `error.metadata`)
- HTTP 400 whose body blames the `reasoning` parameter → retried **once** with the parameter omitted (model default). A reasoning preference never costs a turn, whatever the model.
- In-stream `error` chunk → `OpenRouterError` with a mapped status (capacity language → 429, else 503) so the orchestrator's retry ladder treats it like the same failure before the stream opened
- Network failure / `signal` abort → standard fetch errors propagate
- Every early exit from the SSE stream (`break`, throw, `.return()`) **cancels** the response body so the request actually closes upstream

## Caching

`listModels` caches results for 1 hour per client instance. Force a refetch with `listModels(apiKey, { force: true })`.

## Tests

- [`sse.test.ts`](sse.test.ts) — parser edge cases (CRLF, [DONE], chunk boundaries)
- [`reasoning.test.ts`](reasoning.test.ts) — mapping table
- [`client.test.ts`](client.test.ts) — streaming text / reasoning / tool calls, error paths, model listing, caching

All tests use a mock `fetch` injected via `createOpenRouterClient({ fetch })`.

## Lands in

Phase 1.2.

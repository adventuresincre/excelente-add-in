import type {
  ChatMessage,
  FinishReason,
  ModelInfo,
  OpenRouterClient,
  ReasoningLevel,
  Usage,
} from "../openrouter";
import { callVisionModel, OpenRouterError } from "../openrouter";
import { toolResultMessage } from "./messages";
import { compactMessages, needsCompaction } from "./compaction";
import { summarizeConversation } from "./conversation-summary";
import { truncateToolResultMessage } from "./truncation";
import type { ExcelDataSource, SelectionInfo } from "../context";
import type { HookRegistry } from "../hooks";
import type { SkillRegistry } from "../skills";
import type { ToolPermission, ToolRegistry, UndoStack } from "../tools";
import { runSubagent } from "./subagent";
import { steeringWireContent, type SteeringQueue } from "./steering";

export type ApprovalDecision = "approve" | "deny" | "approve-all";

export interface ToolCallRequest {
  callId: string;
  toolName: string;
  input: unknown;
}

/**
 * Why a model stream is being retried. `capacity` is a rate limit or a
 * saturated provider pool (429), `provider` a gateway or upstream fault
 * (408 / 5xx), `network` a transport failure with no status at all. Copy
 * only — the backoff ladder is the same for all three.
 */
export type StreamRetryReason = "capacity" | "provider" | "network";

export type AgentEvent =
  | { type: "text-delta"; text: string }
  | { type: "reasoning-delta"; text: string }
  | {
      type: "tool-call-pending";
      callId: string;
      toolName: string;
      input: unknown;
      requiredPermission: ToolPermission;
    }
  | { type: "tool-call-approved"; callId: string }
  | { type: "tool-call-rejected"; callId: string }
  | { type: "tool-call-result"; callId: string; result: unknown }
  | { type: "tool-call-error"; callId: string; error: string }
  | {
      /**
       * Compaction is about to start — UI surfaces a "Compacting earlier
       * messages…" indicator. Fires before the summarizer meta-call.
       */
      type: "compaction-started";
    }
  | {
      /**
       * Compaction finished. `compactedCount` is the number of older
       * messages folded into the summary; `summary` is the summary text
       * the UI can render as a SystemNoticeItem so the user sees what
       * was compacted (and the chat history reflects the new state).
       */
      type: "compaction-finished";
      compactedCount: number;
      summary: string;
    }
  | {
      /**
       * Emitted when a tool mutates the orchestrator's session permission via
       * `ctx.setSessionPermission` — the tool-driven equivalent of the user
       * clicking the Plan-mode pill. The UI subscribes to mirror chatMode.
       */
      type: "permission-changed";
      sessionPermission: ToolPermission;
    }
  | {
      /**
       * A transient model-stream failure (429 / 5xx / network drop) is being
       * retried. Surfaced so the UI can show "Provider is busy — retrying…"
       * instead of appearing frozen during the backoff wait.
       */
      type: "stream-retry";
      attempt: number;
      maxAttempts: number;
      error: string;
      reason: StreamRetryReason;
      /**
       * How much of the failed attempt already reached the consumer, in
       * characters of text and of reasoning. The retry replays the turn
       * from scratch, so every consumer MUST drop exactly this much from
       * the tail of the assistant turn it is building — the UI's streaming
       * item, a sub-agent's accumulated summary — or the output duplicates.
       * Absent when nothing had streamed.
       */
      discard?: { text: number; reasoning: number };
    }
  | {
      /**
       * A queued mid-run user message was appended to the conversation at a
       * tool boundary. The UI resolves its "queued" pill into a real user
       * item at this point — item order then matches conversation order, so
       * `itemsToMessages` replay stays wire-valid.
       */
      type: "steering-delivered";
      id: string;
      text: string;
      selection?: SelectionInfo | null;
    }
  | { type: "usage"; usage: Usage }
  | { type: "done"; finishReason: FinishReason };

export interface OrchestratorDeps {
  client: OpenRouterClient;
  /**
   * Client used for a ROLE call (sub-agent, vision, summary) that carries an
   * explicit model override. Defaults to `client`, which is the only correct
   * answer whenever both are the same account.
   *
   * It exists for one asymmetric case: the primary is A.CRE Free, so
   * `client` is A.CRE's proxy on A.CRE's key with the model pinned
   * server-side. A role override sent there would be silently replaced by
   * the pinned model — the user's pick would appear to work and do nothing.
   * Pointing role overrides at the user's own OpenRouter client instead
   * makes the override real, at the cost of that role billing to the user's
   * key while the primary loop stays on A.CRE's. Callers opt in by setting
   * this; passing role overrides with no `roleClient` keeps the old
   * single-client behavior.
   */
  roleClient?: OpenRouterClient;
  registry: ToolRegistry;
  ds: ExcelDataSource;
  undoStack: UndoStack;
  /** Optional — when present, tools can fetch skill resources via ToolContext. */
  skillRegistry?: SkillRegistry;
  /**
   * Optional hook registry. When present, the orchestrator fires
   * `PreToolUse` before each tool (handlers can veto) and `PostToolUse`
   * after each result / error.
   */
  hooks?: HookRegistry;
  /**
   * Called once per pending write-tool invocation. The orchestrator pauses
   * until this resolves. `approve-all` skips approvals for the remainder of
   * the run.
   */
  onApprovalRequest: (call: ToolCallRequest) => Promise<ApprovalDecision>;
  /**
   * Forward `ask_user_question` tool calls to the UI. The orchestrator
   * passes this through to ToolContext.askUser; the actual UI bridge lives
   * in useAskUserQueue.
   */
  askUser?: NonNullable<import("../tools").ToolContext["askUser"]>;
  /**
   * Forward `propose_skill` proposals to the UI. The
   * orchestrator passes this through to ToolContext.proposeSkill; the
   * actual UI bridge lives in useSkillProposalQueue.
   */
  proposeSkill?: NonNullable<import("../tools").ToolContext["proposeSkill"]>;
  /**
   * Backoff sleep used between model-stream retries. Defaults to a real
   * timer that settles early on abort. Injectable so tests can exercise the
   * retry ladder without waiting out the real delays.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface RunOptions {
  apiKey: string;
  /**
   * Credential for `deps.roleClient`. Required when that client
   * authenticates differently from `deps.client` — which is the whole
   * reason it exists (A.CRE Free's proxy takes no credential at all).
   * Defaults to `apiKey`.
   */
  roleApiKey?: string;
  modelId: string;
  reasoning?: ReasoningLevel;
  /**
   * `modelId`'s reasoning policy. Required for "off" to actually mean off —
   * see `reasoningParamFor`. Role calls do not carry one: they either take
   * no reasoning at all (summary, vision) or inherit the primary's level on
   * a different model, where the primary's policy would be the wrong answer.
   */
  reasoningPolicy?: ModelInfo["reasoningPolicy"];
  /**
   * Optional override for sub-agent dispatch. When set, `spawn_subagent`
   * runs its child on this model instead of `modelId`. Defaults to
   * `modelId` so existing call sites keep their behavior.
   */
  subagentModelId?: string;
  /**
   * Optional vision-model override. When set, tools that produce images
   * (the `screenshot` tool) route the image to this
   * model in a one-shot call and return the model's text reply. Keeps
   * the primary's conversation history text-only — required for non-
   * vision primaries, and beneficial for caching even when the primary
   * does support vision.
   */
  visionModelId?: string;
  /**
   * Optional summary-model override. When the running conversation
   * exceeds the compaction budget, the orchestrator calls this model to
   * summarize older messages into a single structured report. Defaults
   * to the primary; users can set this to a cheaper model (Haiku,
   * Qwen-Turbo) since summarization doesn't need top-tier reasoning and
   * runs once per long session.
   */
  summaryModelId?: string;
  /** Prepended to the conversation if provided. */
  systemPrompt?: string;
  /** Conversation so far (user + assistant + tool turns). */
  messages: ChatMessage[];
  /**
   * Allowlist tools by name. Defaults to all registered.
   *
   * Enforced in BOTH directions: the allowlist filters what gets advertised
   * to the model AND what the orchestrator is willing to dispatch. Filtering
   * only the advertisement would make every allowlist in the system
   * advisory — a model can name any tool it likes (from training, from a
   * stale turn, or because injected content told it to), and the registry is
   * shared process-wide. Sub-agent role allowlists, the plan-mode block, and
   * the inactive-connector gate all depend on this being a real boundary.
   */
  toolAllowlist?: string[];
  /** Cap the number of model turns to prevent runaways. Default 12. */
  maxTurns?: number;
  /**
   * Permission level the current session is allowed to operate at. Read tools
   * always run; Write tools either go through the approval flow (when session
   * is Write) or get denied with a structured ToolResult (when session is
   * Read). Defaults to "Write".
   */
  sessionPermission?: ToolPermission;
  /**
   * True when this orchestrator is running inside a sub-agent. Passed through
   * to ToolContext so `spawn_subagent` can refuse recursive spawning.
   */
  isSubagent?: boolean;
  /**
   * Conversation id propagated into hook contexts so handlers know which
   * session they're observing. Sub-agents inherit the parent's id.
   */
  conversationId?: string | null;
  /**
   * Mid-run steering. When present, the orchestrator drains this queue at
   * every tool boundary (start of each turn, after the previous batch's
   * results) and appends each entry as a user message, emitting
   * `steering-delivered` per entry. If the model finishes with no tool
   * calls while messages are queued, the run continues so the interjection
   * gets a response instead of dying undelivered. Primary runs only —
   * sub-agents never receive a queue.
   */
  steering?: SteeringQueue;
  signal?: AbortSignal;
}

export interface Orchestrator {
  run(opts: RunOptions): AsyncIterable<AgentEvent>;
}

export function createOrchestrator(deps: OrchestratorDeps): Orchestrator {
  return {
    run(opts) {
      return runStream(deps, opts);
    },
  };
}

async function* runStream(deps: OrchestratorDeps, opts: RunOptions): AsyncIterable<AgentEvent> {
  // Institutional builds (apartment development + waterfall, multi-tab DCF
  // with sensitivities, full audit pass) run 35–55 tool calls — roughly
  // 8–15 model turns. This fallback mirrors the Settings "Balanced" preset
  // and only applies when the caller passes nothing; the pane always passes
  // a value. Sub-agents stay capped lower via SubagentOptions.
  const maxTurns = opts.maxTurns ?? 100;
  // Mutable across the run — `enter_plan_mode` flips it via the
  // ctx.setSessionPermission callback below.
  let sessionPermission: ToolPermission = opts.sessionPermission ?? "Write";
  const isSubagent = opts.isSubagent ?? false;
  let approveAll = false;
  // Tools mutate sessionPermission via this queue so the orchestrator can
  // emit a `permission-changed` event AFTER the tool's result event lands —
  // keeping the ordering clean (result → permission-changed → next call).
  const pendingPermissionChange: { value: ToolPermission | null } = { value: null };

  // Dispatch-side view of the allowlist. `undefined` means "everything
  // registered"; a set means the model may only reach these names no matter
  // what it asks for.
  const allowedTools = opts.toolAllowlist ? new Set(opts.toolAllowlist) : null;

  const conversation: ChatMessage[] = [];
  if (opts.systemPrompt) {
    conversation.push({ role: "system", content: opts.systemPrompt });
  }
  conversation.push(...opts.messages);

  for (let turn = 0; turn < maxTurns; turn++) {
    // Deliver queued mid-run user messages. This is the only point in the
    // loop where a user message is wire-legal: the previous batch's tool
    // results are all appended, and the next assistant turn hasn't started.
    // Drained before the compaction check so an injected message is part of
    // the conversation compaction sees.
    if (opts.steering) {
      for (const m of opts.steering.drain()) {
        conversation.push({ role: "user", content: steeringWireContent(m) });
        yield {
          type: "steering-delivered",
          id: m.id,
          text: m.text,
          selection: m.selection,
        };
      }
    }

    const turnTools = new Map<number, PendingToolCall>();
    let assistantContent = "";
    let finishReason: FinishReason | null = null;

    // Conversation compaction. If the running token estimate is past the
    // ~200k working-set budget, we invoke a summarizer meta-call that
    // folds older messages into a single structured summary. The summary
    // becomes a system-role message in `conversation`, so subsequent
    // turns are cheap (the compacted state IS the new conversation, not
    // a per-turn wire-only view).
    //
    // Reference-tool exempts (load_skill, read_skill_resource,
    // read_workbook_memory) and the last RECENT_FLOOR messages always
    // survive — agent keeps its loaded playbooks + immediate context.
    if (needsCompaction(conversation)) {
      yield { type: "compaction-started" };
      try {
        const summary = roleTargetFor(deps, opts, opts.summaryModelId);
        const result = await compactMessages(conversation, async (compactable) => {
          return await summarizeConversation(summary.client, {
            apiKey: summary.apiKey,
            // Summary model defaults to the primary; opts.summaryModelId
            // (if set in prefs) lets users route summarization through a
            // cheaper model since it doesn't need top-tier reasoning.
            modelId: summary.modelId,
            messages: compactable,
            signal: opts.signal,
          });
        });
        // Replace conversation IN PLACE so subsequent turns see the
        // compacted state, not the original. This is the "amortize the
        // meta-call across the rest of the run" property.
        conversation.length = 0;
        conversation.push(...result.messages);
        yield {
          type: "compaction-finished",
          compactedCount: result.compactedCount,
          summary: result.summary,
        };
      } catch (e) {
        // Compaction failed — most likely a network blip or the summary
        // model rejecting the request. Don't crash the run; just continue
        // with the un-compacted conversation. The model may degrade
        // slightly but it'll still respond.
        const message = e instanceof Error ? e.message : String(e);
        yield {
          type: "compaction-finished",
          compactedCount: 0,
          summary: `(compaction failed: ${message})`,
        };
      }
    }

    // The model stream is the one call in this loop that used to run
    // unguarded — a transient 429 or a dropped connection anywhere in a long
    // autonomous build threw straight out of the generator and ended the
    // run, discarding everything done so far. Retry transient failures with
    // backoff. When the failed attempt had already streamed output to the
    // consumer, the retry event carries exactly how much, and the consumer
    // drops it before the replay arrives — so a provider that dies
    // mid-answer ("ResourceExhausted: Worker local total request limit
    // reached (16/16)", a shared free-pool ceiling nothing on our side can
    // prevent) costs a visible hiccup, not the run. The one hard stop is a
    // `usage` event: by then the turn was complete and billed, and
    // replaying it would bill it twice.
    for (let attempt = 0; ; attempt++) {
      turnTools.clear();
      assistantContent = "";
      finishReason = null;
      let streamedText = 0;
      let streamedReasoning = 0;
      let usageYielded = false;

      try {
        for await (const event of deps.client.chat({
          apiKey: opts.apiKey,
          model: opts.modelId,
          messages: conversation,
          tools: deps.registry.toWireFormat(opts.toolAllowlist),
          reasoning: opts.reasoning,
          reasoningPolicy: opts.reasoningPolicy,
          signal: opts.signal,
        })) {
          switch (event.type) {
            case "text-delta":
              assistantContent += event.text;
              streamedText += event.text.length;
              yield { type: "text-delta", text: event.text };
              break;
            case "reasoning-delta":
              streamedReasoning += event.text.length;
              yield { type: "reasoning-delta", text: event.text };
              break;
            case "tool-call-start":
              turnTools.set(event.index, { id: event.id, name: event.name, arguments: "" });
              break;
            case "tool-call-delta": {
              const tc = turnTools.get(event.index);
              if (tc) tc.arguments += event.argumentsDelta;
              break;
            }
            case "usage":
              usageYielded = true;
              yield { type: "usage", usage: event.usage };
              break;
            case "done":
              finishReason = event.finishReason;
              break;
          }
        }
        break;
      } catch (e) {
        const canRetry =
          !usageYielded &&
          attempt < MAX_STREAM_RETRIES &&
          !isAbortError(e, opts.signal) &&
          isRetryableStreamError(e);
        if (!canRetry) throw e;

        const streamed = streamedText + streamedReasoning > 0;
        yield {
          type: "stream-retry",
          attempt: attempt + 1,
          maxAttempts: MAX_STREAM_RETRIES,
          error: e instanceof Error ? e.message : String(e),
          reason: retryReason(e),
          ...(streamed ? { discard: { text: streamedText, reasoning: streamedReasoning } } : {}),
        };
        await (deps.sleep ?? delayWithAbort)(retryDelayMs(attempt, e), opts.signal);
      }
    }

    const tools = Array.from(turnTools.values());

    // Append the assistant turn (with any tool_calls) to the conversation.
    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: assistantContent,
    };
    if (tools.length > 0) {
      assistantMsg.tool_calls = tools.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: tc.arguments },
      }));
    }
    conversation.push(assistantMsg);

    if (tools.length === 0) {
      // A steering message arrived while the final response streamed. Don't
      // end the run with it undelivered — loop again so the top-of-turn
      // drain appends it and the model answers. Still bounded by maxTurns.
      if (opts.steering && opts.steering.size() > 0) {
        continue;
      }
      yield { type: "done", finishReason: finishReason ?? "stop" };
      return;
    }

    // Execute each tool call, gating writes through the approval callback.
    for (const call of tools) {
      const tool = deps.registry.get(call.name);

      let input: unknown = {};
      if (call.arguments && call.arguments.trim() !== "") {
        try {
          input = JSON.parse(call.arguments);
        } catch (e) {
          const message = `Invalid JSON arguments: ${(e as Error).message}`;
          yield { type: "tool-call-error", callId: call.id, error: message };
          conversation.push(toolResultMessage(call.id, { error: message }, call.name));
          continue;
        }
      }

      if (!tool) {
        const message = `Unknown tool: ${call.name}`;
        yield { type: "tool-call-error", callId: call.id, error: message };
        conversation.push(toolResultMessage(call.id, { error: message }, call.name));
        continue;
      }

      // Allowlist enforcement at DISPATCH, not just at advertisement. The
      // tool exists in the shared registry, but this run isn't permitted to
      // reach it — a sub-agent naming a tool outside its role, a plan-mode
      // turn reaching for a writer, or a call into a connector the user has
      // switched off. Reported as a structured result so the model can pick
      // a different approach instead of silently retrying.
      if (allowedTools && !allowedTools.has(call.name)) {
        const message =
          `Tool not available in this run: ${call.name}. ` +
          `Available tools: ${[...allowedTools].join(", ")}.`;
        yield { type: "tool-call-error", callId: call.id, error: message };
        conversation.push(toolResultMessage(call.id, { error: message }, call.name));
        if (deps.hooks) {
          await deps.hooks.fire({
            event: "PostToolUse",
            toolName: call.name,
            input,
            error: message,
            conversationId: opts.conversationId ?? null,
          });
        }
        continue;
      }

      yield {
        type: "tool-call-pending",
        callId: call.id,
        toolName: call.name,
        input,
        requiredPermission: tool.requiredPermission,
      };

      // Permission gate. Write tools at a Read session are denied with a
      // structured ToolResult the model can adapt to (e.g., a sub-agent
      // asking for a write reports it can't, and the parent decides). At a
      // Write session, Write tools still route through the approval UI.
      if (tool.requiredPermission === "Write" && sessionPermission === "Read") {
        const message = `Permission denied: ${call.name} requires Write but this session is Read-only.`;
        yield { type: "tool-call-rejected", callId: call.id };
        conversation.push(toolResultMessage(call.id, { error: message }, call.name));
        if (deps.hooks) {
          await deps.hooks.fire({
            event: "PostToolUse",
            toolName: call.name,
            input,
            error: message,
            conversationId: opts.conversationId ?? null,
          });
        }
        continue;
      }

      // PreToolUse hook — handlers can veto with a reason. Vetoes are
      // surfaced to the model as a tool-call-error so it can adapt or
      // try a different approach. Runs BEFORE the approval gate so the
      // user isn't prompted for a tool a guard would reject anyway.
      if (deps.hooks) {
        const { veto } = await deps.hooks.fire({
          event: "PreToolUse",
          toolName: call.name,
          input,
          requiredPermission: tool.requiredPermission,
          conversationId: opts.conversationId ?? null,
        });
        if (veto) {
          const message = `Pre-tool-use hook vetoed ${call.name}: ${veto}`;
          yield { type: "tool-call-error", callId: call.id, error: message };
          conversation.push(toolResultMessage(call.id, { error: message }, call.name));
          await deps.hooks.fire({
            event: "PostToolUse",
            toolName: call.name,
            input,
            error: message,
            conversationId: opts.conversationId ?? null,
          });
          continue;
        }
      }

      if (tool.requiredPermission === "Write" && !approveAll) {
        const decision = await deps.onApprovalRequest({
          callId: call.id,
          toolName: call.name,
          input,
        });
        if (decision === "approve-all") {
          approveAll = true;
        } else if (decision === "deny") {
          const message = "User denied this write.";
          yield { type: "tool-call-rejected", callId: call.id };
          conversation.push(toolResultMessage(call.id, { error: message }, call.name));
          // Same contract as the other terminal branches: hook subscribers
          // (audit trails, memory observers) must see vetoed writes too.
          if (deps.hooks) {
            await deps.hooks.fire({
              event: "PostToolUse",
              toolName: call.name,
              input,
              error: message,
              conversationId: opts.conversationId ?? null,
            });
          }
          continue;
        }
      }

      yield { type: "tool-call-approved", callId: call.id };

      try {
        const result = await tool.execute(input, {
          ds: deps.ds,
          undoStack: deps.undoStack,
          signal: opts.signal,
          skillRegistry: deps.skillRegistry,
          isSubagent,
          setSessionPermission: (perm) => {
            sessionPermission = perm;
            pendingPermissionChange.value = perm;
          },
          askUser: deps.askUser,
          proposeSkill: deps.proposeSkill,
          visionCall: opts.visionModelId
            ? (args) => {
                const vision = roleTargetFor(deps, opts, opts.visionModelId);
                return callVisionModel(vision.client, {
                  modelId: vision.modelId,
                  apiKey: vision.apiKey,
                  imageDataUrl: args.imageDataUrl,
                  context: args.context,
                  question: args.question,
                  signal: opts.signal,
                });
              }
            : undefined,
          runSubagent: (subOpts) => {
            // Use the subagent model override if configured, else fall back
            // to the primary. `client` is swapped too, because a sub-agent
            // runs a whole nested orchestrator loop — handing it the wrong
            // client would route every one of its turns to the wrong
            // account, not just the first.
            const sub = roleTargetFor(deps, opts, opts.subagentModelId);
            return runSubagent(
              { ...deps, client: sub.client },
              {
                apiKey: sub.apiKey,
                roleApiKey: opts.roleApiKey,
                modelId: sub.modelId,
                reasoning: opts.reasoning,
                signal: opts.signal,
              },
              subOpts
            );
          },
        });
        yield { type: "tool-call-result", callId: call.id, result };
        // UI gets the full result via the event above; the model gets a
        // truncated view so a single oversized read can't blow up the rest
        // of the conversation. See `truncation.ts` for the head/tail split.
        conversation.push(truncateToolResultMessage(toolResultMessage(call.id, result, call.name)));
        if (pendingPermissionChange.value !== null) {
          yield {
            type: "permission-changed",
            sessionPermission: pendingPermissionChange.value,
          };
          pendingPermissionChange.value = null;
        }
        if (deps.hooks) {
          // Fire-and-await PostToolUse so observers complete their work
          // (logging, memory updates) before the next tool dispatch.
          // Errors in observers are swallowed by the registry — they
          // shouldn't break the agent loop.
          await deps.hooks.fire({
            event: "PostToolUse",
            toolName: call.name,
            input,
            result,
            conversationId: opts.conversationId ?? null,
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        yield { type: "tool-call-error", callId: call.id, error: message };
        conversation.push(toolResultMessage(call.id, { error: message }, call.name));
        if (deps.hooks) {
          await deps.hooks.fire({
            event: "PostToolUse",
            toolName: call.name,
            input,
            error: message,
            conversationId: opts.conversationId ?? null,
          });
        }
      }
    }
  }

  // Hit the per-send turn ceiling. Use a distinct finishReason so the UI
  // can tell "agent ran out of turns mid-work" apart from the model's own
  // output-length truncation (both would otherwise report "length"). The
  // UI surfaces a "Continue Working" button on this specific reason.
  yield { type: "done", finishReason: "max-turns" };
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

/**
 * How many times to re-attempt a failed model stream before giving up. Five
 * retries across ~1s + 2s + 4s + 8s + 16s of backoff (±20% jitter; 30s cap
 * when a Retry-After asks for more) is about a minute of patience — enough
 * to ride out a saturated shared provider pool, which is what the free
 * NVIDIA endpoints are, while a genuinely down provider still surfaces
 * within the time a user will wait watching a "retrying" notice. Stop stays
 * one press away throughout: the backoff sleep rejects on abort.
 */
const MAX_STREAM_RETRIES = 5;

/** Retryable: rate limits, gateway/server errors, and transport failures. */
/**
 * Resolves which client, credential, and model a role call (sub-agent,
 * vision, summary) should use.
 *
 * `roleClient` is consulted ONLY when the role carries an explicit override.
 * Without one the role is "same as primary", and the primary's client is the
 * only client that can serve the primary's model — sending the A.CRE Free
 * pinned id to the user's own OpenRouter key would bill them for the model
 * A.CRE is paying for.
 */
function roleTargetFor(
  deps: OrchestratorDeps,
  opts: RunOptions,
  overrideModelId: string | undefined
): { client: OpenRouterClient; apiKey: string; modelId: string } {
  if (overrideModelId && deps.roleClient) {
    return {
      client: deps.roleClient,
      apiKey: opts.roleApiKey ?? opts.apiKey,
      modelId: overrideModelId,
    };
  }
  return {
    client: deps.client,
    apiKey: opts.apiKey,
    modelId: overrideModelId ?? opts.modelId,
  };
}

function isRetryableStreamError(e: unknown): boolean {
  if (e instanceof OpenRouterError) {
    // A proxy that knows a refusal is final (monthly cap, kill switch) says
    // so; retrying it three times with backoff only delays the message.
    if (e.retryable !== undefined) return e.retryable;
    return e.status === 429 || e.status === 408 || e.status >= 500;
  }
  // A network drop / DNS blip / TLS reset surfaces as a bare TypeError from
  // fetch, with no status to inspect. Auth and malformed-request failures
  // arrive as OpenRouterError above, so they never reach this branch.
  return e instanceof TypeError;
}

/** Why a retry is happening, for the UI's notice. */
function retryReason(e: unknown): StreamRetryReason {
  if (e instanceof OpenRouterError) return e.status === 429 ? "capacity" : "provider";
  return "network";
}

/** True when the failure is the user pressing Stop rather than a fault. */
function isAbortError(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return e instanceof Error && e.name === "AbortError";
}

/**
 * Exponential backoff with jitter, honoring a numeric `Retry-After` when the
 * provider sent one (OpenRouter puts it in the 429 body). Capped so a
 * hostile or mistaken value can't park the agent for minutes. The jitter
 * matters most for the case that motivated the ladder: a saturated shared
 * pool stays saturated when every client retries on the same beat.
 */
function retryDelayMs(attempt: number, e: unknown): number {
  const MAX_DELAY_MS = 30_000;
  if (e instanceof OpenRouterError && e.status === 429) {
    const match = /"retry[_-]?after"\s*:\s*(\d+)/i.exec(e.responseBody);
    if (match) {
      const seconds = Number(match[1]);
      if (Number.isFinite(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, MAX_DELAY_MS);
      }
    }
  }
  const base = Math.min(1000 * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/** Sleep that rejects promptly if the run is aborted mid-backoff. */
function delayWithAbort(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Tool-message and tool-call shaping helpers moved to ./messages.ts so the
// orchestrator file stays focused on the run loop and the UI layer can
// share the same builders for lossless replay.

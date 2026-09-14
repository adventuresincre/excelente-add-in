import type { ExcelDataSource } from "../context";
import type { ToolDef as WireToolDef } from "../openrouter";
import type { SkillRegistry } from "../skills";
import type { UndoStack } from "./undo";

/**
 * Options for spawning a sub-agent. See `core/agent/subagent.ts` for the
 * implementation.
 */
export interface SubagentOptions {
  /** The task the child should perform. */
  prompt: string;
  /**
   * Names of tools the child may call. Defaults to all read tools (no writes).
   * Pass a custom allowlist to grant a narrower / wider set.
   */
  toolAllowlist?: string[];
  /** Maximum model turns inside the child. Default 6. */
  maxTurns?: number;
  /** Optional extra system-prompt content for the child. */
  systemPrompt?: string;
  /**
   * Session permission for the child. Defaults to "Read" — the safer default
   * for delegated work. Set to "Write" only for roles that need to mutate
   * the workbook (Builder); writes still go through the parent's approval
   * flow.
   */
  sessionPermission?: "Read" | "Write";
}

export interface SubagentResult {
  /** The child's final assistant text — the parent should treat this as the answer. */
  summary: string;
  /** USD cost of the child's run, if usage info was available. */
  cost?: number;
  /** Number of model turns the child consumed. */
  turns: number;
}

/**
 * Two-level permission gradient. `Read` tools never mutate workbook state and
 * run silently. `Write` tools mutate the workbook (cell values, formulas,
 * formatting, structure) and must be gated through user approval when the
 * session permission is `Write`; if the session is `Read` (e.g. a sub-agent
 * or unapproved plan-mode session), Write tools are denied with a structured
 * `ToolResult` the model can adapt to.
 *
 * Excel writes are categorically reversible via the undo stack
 * (`core/tools/undo.ts`), so unlike Claude Code's five-level gradient we
 * don't need a `DangerFullAccess` tier — every workbook mutation has the
 * same recovery path.
 */
export type ToolPermission = "Read" | "Write";

/**
 * Runtime context handed to every tool.
 */
export interface ToolContext {
  ds: ExcelDataSource;
  undoStack: UndoStack;
  signal?: AbortSignal;
  /**
   * Spawn an isolated child agent. Populated by the orchestrator at tool-
   * execution time. Tools that need this must check it before calling — it
   * may be undefined in test contexts.
   */
  runSubagent?: (opts: SubagentOptions) => Promise<SubagentResult>;
  /**
   * Skill registry — used by `read_skill_resource` to fetch reference files
   * bundled with a skill (per the Open Agent Skills spec's progressive
   * disclosure pattern). May be undefined in tests.
   */
  skillRegistry?: SkillRegistry;
  /**
   * True when this tool is executing inside a sub-agent runtime. Used by
   * `spawn_subagent` to refuse recursive spawning — claw-code's pattern for
   * preventing runaway agent recursion. Undefined / false in the parent
   * orchestrator.
   */
  isSubagent?: boolean;
  /**
   * Change the orchestrator's session permission for the remainder of the
   * current run. Populated by the orchestrator at tool-execute time. Used by
   * `enter_plan_mode` to drop the session from Write to Read mid-turn — the
   * tool-driven equivalent of the user clicking the Plan-mode pill. Yields
   * a `permission-changed` event so the UI can mirror the state.
   */
  setSessionPermission?: (perm: ToolPermission) => void;
  /**
   * Ask the user one or more structured questions and pause until they
   * answer. Used by `ask_user_question` to render multiple-choice cards
   * with free-text fallback. Populated by the orchestrator from the
   * useAskUserQueue UI bridge.
   */
  askUser?: (
    questions: Array<{
      question: string;
      header?: string;
      options: Array<{ label: string; description?: string }>;
      multiSelect?: boolean;
    }>
  ) => Promise<{
    answers: Array<{ picked: string[] } | { text: string } | { cancelled: true }>;
  }>;
  /**
   * Propose a new or updated skill for user review. Used by `propose_skill`
   * (kind = "create" | "update"). The UI renders a review card; on Accept, the host
   * actually persists the skill (the tool doesn't write directly).
   * Resolves with { outcome: "accepted" | "dismissed", name? }.
   */
  proposeSkill?: (proposal: {
    kind: "create" | "update";
    name: string;
    description: string;
    whenToUse?: string;
    body: string;
    references?: Record<string, string>;
  }) => Promise<{ outcome: "accepted" | "dismissed"; name?: string }>;
  /**
   * Route an image to the configured vision model in a one-shot call. When
   * present, screenshot tools call this instead of returning raw image
   * content so the primary's conversation history stays text-only. The
   * orchestrator populates it when `visionModelId` is set in prefs OR when
   * the primary model doesn't support image input. Returns the vision
   * model's text reply.
   */
  visionCall?: (args: {
    imageDataUrl: string;
    context: string;
    question?: string;
  }) => Promise<string>;
}

/**
 * A tool the LLM can call.
 *
 * `input` is the parsed JSON arguments the model produced.
 * `execute` returns a value that will be JSON-serialized and fed back to the
 * model as the tool result. Returning a string is fine -- it'll be sent
 * verbatim.
 */
export interface ToolDef<I = unknown, O = unknown> {
  name: string;
  /** Description the LLM sees. Be specific about when to call this tool. */
  description: string;
  /** JSON Schema for the `input` argument. */
  inputSchema: Record<string, unknown>;
  /**
   * Permission level this tool requires to run. `Read` tools run silently;
   * `Write` tools are gated through the approval flow (or denied when the
   * session permission is `Read`).
   */
  requiredPermission: ToolPermission;
  /**
   * Optional source tag — built-in tools omit this; tools bridged from
   * external sources (MCP servers, future plugins) set it so the registry
   * can find + bulk-remove tools belonging to a single source when it
   * disconnects. Format: `mcp:${serverName}` for MCP tools.
   */
  source?: string;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export interface ToolRegistry {
  /** All registered tools in declaration order. */
  all(): ToolDef[];
  /** Look up a tool by name. */
  get(name: string): ToolDef | undefined;
  /** Subset of tools by allowlist (used for sub-agents in Phase 5). */
  filter(allowlist: string[]): ToolDef[];
  /**
   * The tools array in the shape OpenRouter expects on the chat request.
   */
  toWireFormat(allowlist?: string[]): WireToolDef[];
  /**
   * Add tools to the live registry. Used at runtime by the MCP layer when a
   * server connects and exposes its tools. Throws on duplicate names.
   */
  addAll(tools: ToolDef[]): void;
  /**
   * Remove every tool whose `source` field matches. Used when an MCP server
   * is removed by the user or disconnects. No-op if nothing matches.
   */
  removeBySource(source: string): void;
}

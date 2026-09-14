import type { ToolPermission } from "../tools";

/**
 * Lifecycle events handlers can subscribe to. Modeled on Claude Code's
 * hooks, scoped to what the Excelente orchestrator + Office.js can
 * observe natively.
 *
 * - `SessionStart` fires once when a new conversation begins (first user
 *   message of a fresh chat). Use to warm context, fetch external data,
 *   load workbook-specific configuration.
 * - `PreToolUse` fires before each tool executes — handlers can veto with
 *   a reason, which the orchestrator surfaces as a tool-call-error the
 *   model can adapt to (e.g., a linter rejecting a malformed formula).
 * - `PostToolUse` fires after a tool returns (result OR error) — purely
 *   observational; the return value is ignored.
 * - `WorkbookSaved` fires when Excel reports the workbook was saved
 *   (Office.js `worksheet.onSaved` or workbook-level equivalent). Use to
 *   trigger scheduled audits, sync external state, log session
 *   checkpoints.
 * - `SheetChanged` fires when a watched sheet's contents change
 *   (`Worksheet.onChanged`). Use to react to user edits — recompute a
 *   derived block, validate against conventions, warn about formula
 *   drift.
 */
export type HookEvent =
  | "SessionStart"
  | "PreToolUse"
  | "PostToolUse"
  | "WorkbookSaved"
  | "SheetChanged";

export interface SessionStartContext {
  event: "SessionStart";
  /** Conversation id minted for this session (UUID). */
  conversationId: string;
  /** Workbook id the session is scoped to. */
  workbookId: string;
}

export interface PreToolUseContext {
  event: "PreToolUse";
  toolName: string;
  /** Parsed JSON arguments the model is about to pass to the tool. */
  input: unknown;
  /** The tool's declared permission level. */
  requiredPermission: ToolPermission;
  /** The conversation id this tool call belongs to. */
  conversationId: string | null;
}

export interface PostToolUseContext {
  event: "PostToolUse";
  toolName: string;
  input: unknown;
  /** Present when the tool succeeded. */
  result?: unknown;
  /** Present when the tool failed or was vetoed. */
  error?: string;
  conversationId: string | null;
}

export interface WorkbookSavedContext {
  event: "WorkbookSaved";
  /** Conversation id active when the save happened, if any. */
  conversationId: string | null;
}

export interface SheetChangedContext {
  event: "SheetChanged";
  sheetName: string;
  /** A1 address of the changed range, e.g. "B2:C4" or "B2". */
  address: string;
  /** What kind of change Excel reported (e.g. "RangeEdited", "FillRequest").
   * Free-form string from Office.js — see Excel.DataChangeType. */
  changeType?: string;
  conversationId: string | null;
}

export type HookContext =
  | SessionStartContext
  | PreToolUseContext
  | PostToolUseContext
  | WorkbookSavedContext
  | SheetChangedContext;

/**
 * Handler return shape. For `PreToolUse`, a non-empty `veto` aborts the
 * tool call with that string as the failure reason. For other events,
 * the return is ignored. Handlers can also throw — the registry treats
 * a thrown Error as `{ veto: error.message }`.
 */
export interface HookResult {
  veto?: string;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

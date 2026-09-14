import { readWorkbookOverrides, writeWorkbookOverrides, type WorkbookOverrides } from "../memory";
import type { ToolDef } from "./types";

/**
 * Read the workbook's per-workbook setting overrides. These live in cell
 * `B1` of the hidden `_excelente` sheet (alongside the markdown memory in
 * A1) and take precedence over the global OpenRouter API-key + model
 * settings when present.
 *
 * Returns an empty object when no overrides exist — global settings apply.
 */
export const readWorkbookSettingsTool: ToolDef<Record<string, never>, WorkbookOverrides> = {
  name: "read_workbook_settings",
  description:
    "Read the per-workbook setting overrides (model, reasoning). " +
    "These take precedence over the global Settings panel when present. Returns {} when " +
    "no overrides have been written yet — the workbook uses global settings in that case.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(_input, { ds }) {
    return readWorkbookOverrides(ds);
  },
};

interface WriteWorkbookSettingsInput {
  /** Partial overrides — fields you don't set are left unchanged. Pass null
   * for a field to clear it (fall back to global). */
  model?: string | null;
  reasoning?: "off" | "low" | "medium" | "high" | null;
}

/**
 * Update per-workbook overrides. The agent typically invokes this when the
 * user says something like "always use Opus for this workbook." Approval-
 * gated like any Write tool.
 *
 * Merging semantics: fields you OMIT stay at their current value; fields
 * set to `null` clear back to the global default; fields set to a value
 * overwrite.
 *
 * There is intentionally no `autoApproveWrites` field: these overrides live
 * in the workbook file, so a shared template could otherwise ship with the
 * write-approval gate pre-disabled. Users grant auto-approve per session
 * from the approval card instead. See memory/workbook-settings.ts.
 */
export const writeWorkbookSettingsTool: ToolDef<
  WriteWorkbookSettingsInput,
  { written: WorkbookOverrides }
> = {
  name: "write_workbook_settings",
  description:
    "Update the per-workbook setting overrides. Use when the user wants this workbook to " +
    'behave differently from global settings — "use opus for this workbook", etc. Fields ' +
    "you OMIT stay unchanged; set a field to null to clear it back to the global default; " +
    "set to a value to override. Cannot change approval behavior: if the user wants writes " +
    'to stop prompting, tell them to click "Approve all" on an approval card.',
  inputSchema: {
    type: "object",
    properties: {
      model: {
        type: ["string", "null"],
        description: 'OpenRouter model id (e.g. "x-ai/grok-4.6"). null clears.',
      },
      reasoning: {
        type: ["string", "null"],
        enum: ["off", "low", "medium", "high", null],
        description: "Reasoning level for models that support it. null clears.",
      },
    },
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute(input, { ds }) {
    const current = await readWorkbookOverrides(ds);
    const next: WorkbookOverrides = { ...current };

    if (input.model === null) delete next.model;
    else if (input.model !== undefined) next.model = input.model;

    if (input.reasoning === null) delete next.reasoning;
    else if (input.reasoning !== undefined) next.reasoning = input.reasoning;

    await writeWorkbookOverrides(ds, next);
    return { written: next };
  },
};

export const workbookSettingsTools = [readWorkbookSettingsTool, writeWorkbookSettingsTool];

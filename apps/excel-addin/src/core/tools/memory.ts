import { readWorkbookMemory, writeWorkbookMemory } from "../memory";
import type { ToolDef } from "./types";

interface ReadWorkbookMemoryInput {
  // Empty — memory is a single document per workbook.
}

/**
 * Read the workbook's memory file (Excelente's CLAUDE.md analog). The memory
 * is stored as markdown in a hidden `_excelente` sheet that travels with the
 * workbook; sharing the file ships the memory. Empty when no memory has been
 * written yet — this is the common case for a fresh workbook.
 */
export const readWorkbookMemoryTool: ToolDef<ReadWorkbookMemoryInput, string> = {
  name: "read_workbook_memory",
  description:
    "Read the workbook's memory (markdown in the hidden _excelente sheet; travels with the " +
    "file). It's already in your system prompt when present — re-read only when you need the " +
    "current raw text, e.g. right before writing it. Empty string = no memory yet.",
  inputSchema: {
    type: "object",
    properties: {},
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(_input, { ds }) {
    return readWorkbookMemory(ds);
  },
};

interface WriteWorkbookMemoryInput {
  content: string;
}

/**
 * Overwrite the workbook's memory. Creates the hidden `_excelente` sheet on
 * first write. Gated through the approval UI like any other Write tool.
 */
export const writeWorkbookMemoryTool: ToolDef<WriteWorkbookMemoryInput, { written: number }> = {
  name: "write_workbook_memory",
  description:
    'Overwrite the workbook memory. Use when the user says "remember…", when you\'ve inferred ' +
    "a durable convention, or for /init. REPLACES the whole document (no append) — ALWAYS " +
    "read_workbook_memory first and merge. Cap ~30,000 characters.",
  inputSchema: {
    type: "object",
    properties: {
      content: {
        type: "string",
        description:
          "Full markdown body to store as the workbook's memory. Common sections: modeling " +
          "conventions (units, date format), sheet purposes, named-range vocabulary, user " +
          "preferences. Replaces any existing memory.",
      },
    },
    required: ["content"],
    additionalProperties: false,
  },
  requiredPermission: "Write",
  async execute({ content }, { ds }) {
    await writeWorkbookMemory(ds, content);
    return { written: content.length };
  },
};

export const memoryTools = [readWorkbookMemoryTool, writeWorkbookMemoryTool];

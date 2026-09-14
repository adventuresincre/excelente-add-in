import {
  MAX_TRACE_DEPTH,
  renderDependencyTrace,
  traceDependents,
  tracePrecedents,
} from "../../context";
import type { ToolDef } from "../types";

type TraceDirection = "precedents" | "dependents";

interface TraceDependenciesInput {
  direction: TraceDirection;
  sheetName: string;
  address: string;
  depth?: number;
  scopeSheets?: string[];
}

/**
 * Formula dependency tracing — the agent's equivalent of Excel's Trace
 * Precedents / Trace Dependents, but workbook-wide (cross-sheet references,
 * containing ranges, and named ranges all count) and rendered compactly.
 */
export const traceDependenciesTool: ToolDef<TraceDependenciesInput, string> = {
  name: "trace_dependencies",
  description:
    "Trace Precedents / Trace Dependents, workbook-wide.\n" +
    'direction="dependents" — every formula that READS the target (direct, containing ranges ' +
    "like SUM(B2:B20), cross-sheet, named ranges): the blast radius. Call before overwriting " +
    "cells existing formulas might consume.\n" +
    'direction="precedents" — what the target\'s formulas read; chases a number or error to ' +
    "its source.\n" +
    "depth 2-3 = transitive (default 1). Cannot trace INDIRECT/OFFSET, structured refs, or " +
    "external links — the output flags them when present.",
  inputSchema: {
    type: "object",
    properties: {
      direction: {
        type: "string",
        enum: ["precedents", "dependents"],
        description:
          '"dependents" = what reads the target (blast radius); "precedents" = what the target reads (inputs).',
      },
      sheetName: {
        type: "string",
        description: "Sheet containing the target cell or range.",
      },
      address: {
        type: "string",
        description: 'A1-style cell or rectangular range, e.g. "B5" or "B5:D10".',
      },
      depth: {
        type: "integer",
        minimum: 1,
        maximum: MAX_TRACE_DEPTH,
        description: "How many links to follow. 1 (default) = direct only; 2-3 = transitive chain.",
      },
      scopeSheets: {
        type: "array",
        items: { type: "string" },
        description:
          "Dependents only: restrict the formula scan to these sheets. Omit to scan the " +
          "whole workbook (recommended — cross-sheet breakage is the kind you miss).",
      },
    },
    required: ["direction", "sheetName", "address"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute(input, { ds }) {
    if (input.direction !== "precedents" && input.direction !== "dependents") {
      throw new Error(
        `trace_dependencies: direction must be "precedents" or "dependents" (got "${String(
          input.direction
        )}").`
      );
    }
    if (!input.sheetName || !input.address) {
      throw new Error("trace_dependencies: sheetName and address are both required.");
    }
    if (!/^\$?[A-Za-z]+\$?\d+(:\$?[A-Za-z]+\$?\d+)?$/.test(input.address.trim())) {
      throw new Error(
        `trace_dependencies: address must be an A1 cell or rectangular range like "B5" or ` +
          `"B5:D10" (got "${input.address}"). Whole-column/row targets are not supported — ` +
          `pass the populated extent instead.`
      );
    }

    const target = { sheetName: input.sheetName, address: input.address };
    const opts = { depth: input.depth, scopeSheets: input.scopeSheets };
    const result =
      input.direction === "precedents"
        ? await tracePrecedents(ds, target, opts)
        : await traceDependents(ds, target, opts);
    return renderDependencyTrace(result);
  },
};

# core/tools

Tool registry and Excel tool implementations. The only place `Excel.run` lives.

## Layout (planned)

```
tools/
├── registry.ts        # ToolDef[], JSON schema, OpenRouter format conversion
├── undo.ts            # Snapshot/restore stack (Excel's undo does not see Office.js writes)
├── excel/
│   ├── read.ts        # inspect_workbook (workbook/sheet/range + clipping note), get_selection
│   ├── find.ts        # find_cells — grep over values + formulas, live, never a snapshot
│   ├── trace.ts       # trace_dependencies (precedents / dependents)
│   ├── screenshot.ts  # screenshot (range or chart → PNG / vision)
│   ├── write.ts       # write_range, format_range, undo
│   ├── format.ts      # format_range
│   ├── structure.ts   # insert/delete rows/cols, create/rename/delete sheets, named ranges
│   ├── chart.ts       # create_chart, take_screenshot
│   ├── pivot.ts       # create_pivot_table
│   └── meta.ts        # recalculate, undo
└── meta/
    └── subagent.ts    # spawn_subagent (delegates to core/agent)
```

## Approval gates

Every write tool routes through an approval UI in `ui/taskpane/ToolApproval` before executing. Users can approve once, approve-all-for-session, or deny.

## Public interface (planned)

```ts
export interface ToolDef<I, O> {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  isWrite: boolean;
  execute(input: I, ctx: ToolContext): Promise<O>;
}

export interface ToolRegistry {
  all(): ToolDef<any, any>[];
  get(name: string): ToolDef<any, any> | undefined;
  filter(allowlist: string[]): ToolDef<any, any>[];
}
```

## Dependencies

- Office.js for Excel I/O
- `core/agent` for the sub-agent spawn tool

## Lands in

Phase 3 — Excel tools + agent loop.

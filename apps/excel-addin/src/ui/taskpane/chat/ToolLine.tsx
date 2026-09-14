import type { ToolItem } from "./useAgentStream";

export interface ToolLineProps {
  item: ToolItem;
}

/**
 * Single-line tool indicator. Intentionally muted so a long chain of
 * read/write calls reads as background machinery, not foreground content.
 * Only error / rejected states use color.
 */
export function ToolLine({ item }: ToolLineProps) {
  const icon = item.requiredPermission === "Write" ? "✎" : "·";
  const summary = describeInput(item);
  const title = item.toolName + (summary ? ` — ${summary}` : "");

  return (
    <div className={`tool-line tool-line--${item.status}`} role="status" title={title}>
      <span className="tool-line__icon" aria-hidden="true">
        {icon}
      </span>
      <code className="tool-line__name">{item.toolName}</code>
      {summary && <span className="tool-line__summary">{summary}</span>}
      {item.auto && (
        <span
          className="tool-line__auto"
          role="img"
          aria-label="run automatically by Excelente"
          title="Excelente ran this for you automatically"
        >
          auto
        </span>
      )}
      <StatusGlyph status={item.status} />
      {item.status === "error" && item.error && (
        <span className="tool-line__error" title={item.error}>
          {item.error}
        </span>
      )}
    </div>
  );
}

/**
 * Status indicator for a tool line.
 *
 * `aria-label` on a plain <span> is ignored — a generic element has no role,
 * and ARIA prohibits naming roleless elements, so the labels here were
 * invisible to assistive tech AND flagged by automated checks. `role="img"`
 * gives the glyph a nameable role, so the status is actually announced.
 */
function StatusGlyph({ status }: { status: ToolItem["status"] }) {
  if (status === "pending") {
    return (
      <span
        className="tool-line__glyph tool-line__glyph--pending"
        role="img"
        aria-label="awaiting approval"
      >
        …
      </span>
    );
  }
  if (status === "approved") {
    return (
      <span
        className="tool-line__glyph tool-line__glyph--running"
        role="img"
        aria-label="running"
      >
        <span />
        <span />
        <span />
      </span>
    );
  }
  if (status === "result") {
    return (
      <span className="tool-line__glyph tool-line__glyph--ok" role="img" aria-label="done">
        ✓
      </span>
    );
  }
  return (
    <span className="tool-line__glyph tool-line__glyph--bad" role="img" aria-label="error">
      ✗
    </span>
  );
}

function describeInput(item: ToolItem): string | null {
  const inp = item.input as Record<string, unknown> | null;
  // Harness-made connector calls carry their own summary from the recipe.
  if (item.summary) return item.summary;
  if (!inp || typeof inp !== "object") return null;
  if (typeof inp.sheetName === "string" && typeof inp.address === "string") {
    return `${inp.sheetName}!${inp.address}`;
  }
  if (typeof inp.sheetName === "string") {
    return String(inp.sheetName);
  }
  return null;
}

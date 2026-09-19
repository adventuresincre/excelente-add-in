import { useState } from "react";
import type { ToolItem } from "./useAgentStream";
import { summarizeTool, detailsFor, rawResult } from "./tool-summary";

export interface ToolLineProps {
  item: ToolItem;
}

/**
 * One tool call in the transcript.
 *
 * Collapsed it stays deliberately quiet — a long chain of reads is background
 * machinery, not foreground content — but it now carries the OUTCOME on the
 * right, because a row that only names the call cannot tell a reader whether
 * it worked.
 *
 * Expanding is opt-in and never automatic, including on error: a failed read
 * is often recovered on the next turn, and panels that spring open would make
 * ordinary operation look alarming.
 *
 * The raw tool name is not lost to the plain-language label; it sits in the
 * expanded panel with the permission level, because that string is what
 * someone pastes into a bug report.
 */
export function ToolLine({ item }: ToolLineProps) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const { verb, object, outcome, tone } = summarizeTool(item);
  const icon = item.requiredPermission === "Write" ? "✎" : "·";
  const title = `${item.toolName}${object ? ` — ${object}` : ""}`;

  return (
    <div className={`tool-line-group tool-line-group--${item.status}`} role="status">
      <button
        type="button"
        className={`tool-line tool-line--${item.status}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <span className={`tool-line__caret${open ? " tool-line__caret--open" : ""}`} aria-hidden="true">
          ▸
        </span>
        <span className="tool-line__icon" aria-hidden="true">
          {icon}
        </span>
        <span className="tool-line__verb">{verb}</span>
        {object && <span className="tool-line__summary">{object}</span>}
        {item.auto && (
          <span className="tool-line__auto" title="Excelente ran this for you automatically">
            auto
          </span>
        )}
        {outcome && (
          <span className={`tool-line__outcome tool-line__outcome--${tone}`}>{outcome}</span>
        )}
        <StatusGlyph status={item.status} />
      </button>

      {open && (
        <div className="tool-line__detail">
          <dl className="tool-line__facts">
            {detailsFor(item).map((row, i) => (
              <div className="tool-line__fact" key={`${row.label}-${i}`}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </div>
            ))}
          </dl>
          <button
            type="button"
            className="tool-line__raw-toggle"
            aria-expanded={showRaw}
            onClick={() => setShowRaw((v) => !v)}
          >
            {showRaw ? "Hide raw" : "Show raw"}
          </button>
          {showRaw && <pre className="tool-line__raw">{rawResult(item)}</pre>}
        </div>
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

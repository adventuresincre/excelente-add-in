import type { ToolItem } from "./useAgentStream";

interface ChangeCardProps {
  item: ToolItem;
  /**
   * True when this card corresponds to the most recent undoable write —
   * i.e. clicking Revert will restore THIS card's change without skipping
   * over later writes. The chat panel computes this by tracking which
   * ChangeCard sits at the top of the (UI-visible) write history.
   */
  canRevert: boolean;
  /**
   * True after this card's Revert button has been used. Disables the button
   * and renders the "reverted" badge.
   */
  reverted: boolean;
  onRevert: () => void;
}

/**
 * Replaces the generic ToolLine for write-tool results. Stays on one row at
 * any panel width — the cell-range detail lives in the hover title rather
 * than competing for inline space, and the revert affordance is a small
 * icon button instead of a wrapping text pill.
 */
export function ChangeCard({ item, canRevert, reverted, onRevert }: ChangeCardProps) {
  const range = describeWrite(item);
  const isError = item.status === "error";
  const title = range ? `${titleFor(item)} — ${range}` : titleFor(item);

  return (
    <div
      className={`change-card${reverted ? " is-reverted" : ""}${isError ? " is-error" : ""}`}
      role="status"
      title={title}
    >
      <div className="change-card__row">
        <span className="change-card__icon" aria-hidden="true">
          {reverted ? "↶" : isError ? "✗" : "✎"}
        </span>
        <span className="change-card__title">{titleFor(item)}</span>
        {reverted ? (
          <span className="change-card__badge">reverted</span>
        ) : isError ? (
          <span className="change-card__badge change-card__badge--error">failed</span>
        ) : canRevert ? (
          <button
            type="button"
            className="change-card__revert"
            onClick={onRevert}
            aria-label={`Revert ${title}`}
            title={`Revert — ${title}`}
          >
            <UndoIcon />
          </button>
        ) : (
          <span
            className="change-card__hint"
            title="Only the most recent write can be reverted in-place. Earlier writes can still be undone by reverting newer ones first."
          >
            superseded
          </span>
        )}
      </div>
      {isError && item.error && <div className="change-card__error">{item.error}</div>}
    </div>
  );
}

function titleFor(item: ToolItem): string {
  switch (item.toolName) {
    case "write_range":
      return "Wrote values / formulas";
    case "format_range":
      return "Applied formatting";
    case "write_workbook_memory":
      return "Updated workbook memory";
    case "undo":
      return "Restored prior contents";
    default:
      return item.toolName;
  }
}

function describeWrite(item: ToolItem): string | null {
  const result = item.result as
    | { written?: string; rowCount?: number; columnCount?: number }
    | undefined;
  if (result?.written) {
    const dims =
      result.rowCount && result.columnCount ? ` (${result.rowCount}×${result.columnCount})` : "";
    return `${result.written}${dims}`;
  }
  const input = item.input as { sheetName?: string; address?: string } | null;
  if (input?.sheetName && input?.address) return `${input.sheetName}!${input.address}`;
  return null;
}

function UndoIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

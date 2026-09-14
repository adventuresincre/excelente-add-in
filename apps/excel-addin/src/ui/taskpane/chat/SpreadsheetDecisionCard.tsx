interface SpreadsheetDecisionCardProps {
  filename: string;
  worksheetCount: number;
  isMacroEnabled: boolean;
  /** Whether the "Insert worksheets" path is available on this host/file. */
  canInsert: boolean;
  /** Tooltip explaining why insert is disabled, when it is. */
  insertDisabledReason?: string;
  /** True while an insert/parse action is running — disables both buttons. */
  busy: boolean;
  onInsert: () => void;
  onReadAsText: () => void;
  onDismiss: () => void;
}

/**
 * Decision card shown when the user drops an Excel file. Mirrors the
 * ApprovalCard / AskUserCard visual language — warm-white surface, gold
 * accent on the primary action, a quiet secondary, and a dismiss ✕. Two
 * paths:
 *   - Insert worksheets → adds them to the live workbook (full fidelity).
 *   - Read as text → agent reads the contents without touching the file.
 */
export function SpreadsheetDecisionCard({
  filename,
  worksheetCount,
  isMacroEnabled,
  canInsert,
  insertDisabledReason,
  busy,
  onInsert,
  onReadAsText,
  onDismiss,
}: SpreadsheetDecisionCardProps) {
  return (
    <div className="sheet-decision" role="dialog" aria-label={`How to handle ${filename}`}>
      <div className="sheet-decision__header">
        <span className="sheet-decision__icon" aria-hidden="true">
          📊
        </span>
        <span className="sheet-decision__title">{filename}</span>
        <span className="sheet-decision__meta">
          {worksheetCount} worksheet{worksheetCount === 1 ? "" : "s"}
        </span>
        <button
          type="button"
          className="sheet-decision__dismiss"
          onClick={onDismiss}
          disabled={busy}
          aria-label={`Dismiss ${filename}`}
        >
          ✕
        </button>
      </div>

      <p className="sheet-decision__prompt">How would you like the agent to handle this file?</p>

      <div className="sheet-decision__options">
        <button
          type="button"
          className="sheet-decision__option sheet-decision__option--primary"
          onClick={onInsert}
          disabled={!canInsert || busy}
          title={!canInsert ? insertDisabledReason : undefined}
        >
          <span className="sheet-decision__option-label">Insert worksheets</span>
          <span className="sheet-decision__option-hint">
            {canInsert
              ? "Adds them to your workbook so the agent can build from them."
              : insertDisabledReason}
          </span>
        </button>

        <button
          type="button"
          className="sheet-decision__option"
          onClick={onReadAsText}
          disabled={busy}
        >
          <span className="sheet-decision__option-label">Read as text</span>
          <span className="sheet-decision__option-hint">
            Agent reads the contents without changing your file.
          </span>
        </button>
      </div>

      {isMacroEnabled && (
        <p className="sheet-decision__note">
          Macros aren’t imported — only the worksheet data and formulas.
        </p>
      )}
      {busy && <p className="sheet-decision__note">Working…</p>}
    </div>
  );
}

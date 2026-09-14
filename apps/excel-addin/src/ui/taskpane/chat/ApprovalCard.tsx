import { useEffect, useId, useRef } from "react";
import type { ApprovalDecision, ToolCallRequest } from "../../../core/agent";

export interface ApprovalCardProps {
  call: ToolCallRequest;
  onDecide: (decision: ApprovalDecision) => void;
}

export function ApprovalCard({ call, onDecide }: ApprovalCardProps) {
  const summary = summarize(call);
  const cardRef = useRef<HTMLDivElement>(null);
  const headingId = useId();
  const summaryId = useId();

  // Move focus to the card when it appears, and hand focus back where it
  // came from when it resolves.
  //
  // Without this the approval gate is effectively unreachable without a
  // mouse: the card is appended to the end of a long transcript, nothing
  // tells a screen-reader user it arrived, and reaching it means tabbing
  // blindly through the whole conversation. This is the one control in the
  // product that must never be missed — the agent is blocked until it is
  // answered, and it is the consent step for every workbook write.
  //
  // Focus lands on the CARD, not on a button: `role="alertdialog"` makes
  // the screen reader announce the card and its description, and leaving no
  // action pre-selected means a stray Enter or Space cannot approve a write
  // the user has not read. Tab reaches Approve/Deny from here.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      // Only restore if focus is still inside the card we're unmounting;
      // if the user has since clicked elsewhere, leave them be.
      if (cardRef.current?.contains(document.activeElement)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [call.callId]);

  return (
    <div
      ref={cardRef}
      className="approval-card"
      role="alertdialog"
      aria-modal="false"
      tabIndex={-1}
      aria-labelledby={headingId}
      aria-describedby={summary ? summaryId : undefined}
    >
      <div className="approval-card__header">
        <span className="approval-card__icon" aria-hidden="true">
          ✎
        </span>
        <div className="approval-card__heading" id={headingId}>
          <strong>{call.toolName}</strong> wants to modify the workbook.
        </div>
      </div>

      {summary && (
        <div className="approval-card__summary" id={summaryId}>
          {summary}
        </div>
      )}

      <details className="approval-card__details">
        <summary>Show full input</summary>
        <pre className="approval-card__json">{JSON.stringify(call.input, null, 2)}</pre>
      </details>

      <div className="approval-card__actions">
        <button
          type="button"
          className="approval-card__btn approval-card__btn--approve"
          onClick={() => onDecide("approve")}
        >
          Approve
        </button>
        <button
          type="button"
          className="approval-card__btn approval-card__btn--deny"
          onClick={() => onDecide("deny")}
        >
          Deny
        </button>
        <button
          type="button"
          className="approval-card__btn approval-card__btn--approve-all"
          onClick={() => onDecide("approve-all")}
          title="Skip approval for further writes this session"
        >
          Approve all
        </button>
      </div>
    </div>
  );
}

/**
 * Single-line summary for the common case (write_range with sheet/address).
 * Falls back to nothing for tools whose input shape we don't recognize.
 */
function summarize(call: ToolCallRequest): string | null {
  if (call.toolName === "write_range" && isWriteRangeInput(call.input)) {
    const rows = call.input.formulas.length;
    const cols = call.input.formulas[0]?.length ?? 0;
    const cellCount = rows * cols;
    return `${call.input.sheetName}!${call.input.address} — ${cellCount} cell${cellCount === 1 ? "" : "s"}`;
  }
  if (call.toolName === "undo") {
    return "Restore the most recent write to its prior contents.";
  }
  return null;
}

interface WriteRangeShape {
  sheetName: string;
  address: string;
  formulas: string[][];
}

function isWriteRangeInput(input: unknown): input is WriteRangeShape {
  if (typeof input !== "object" || input === null) return false;
  const x = input as Record<string, unknown>;
  return (
    typeof x.sheetName === "string" &&
    typeof x.address === "string" &&
    Array.isArray(x.formulas)
  );
}

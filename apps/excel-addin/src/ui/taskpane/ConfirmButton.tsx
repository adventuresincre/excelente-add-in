import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import "./confirm-button.css";

export interface ConfirmButtonProps {
  /**
   * The question the user is answering, e.g. `Delete "Q3 model"?`. Becomes
   * the confirm group's accessible name and is shown inline as text.
   */
  question: string;
  /** Label on the destructive button, e.g. "Delete", "Uninstall", "Remove". */
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  /** Class for the trigger button — call sites keep their existing styling. */
  className?: string;
  title?: string;
  "aria-label"?: string;
  /** Trigger content, typically "✕". */
  children: ReactNode;
}

/**
 * Two-step destructive action rendered entirely inside the pane.
 *
 * Why this exists: `window.confirm()` does not work in an Office add-in on
 * Excel for Mac. The task pane is a WKWebView, and the host does not
 * implement the native dialog hooks — `confirm()` returns false at once, so
 * the guarded action silently never runs. Round-3 Mac testing (2026-09-04)
 * hit exactly this: "it won't let me delete history on Excel for Mac". The
 * same call existed on skill uninstall and connector removal. Anything that
 * needs a yes/no from the user has to be drawn by us, not the browser.
 *
 * Interaction: click the trigger → the trigger is replaced in place by the
 * question plus [confirm] [Cancel]. Focus moves to the GROUP, not to either
 * button, so a screen reader announces the question and a stray Enter or
 * Space carried over from the trigger press cannot fire the destructive
 * action (same rule ApprovalCard follows). Escape cancels; so does focus
 * leaving the group, so an abandoned prompt never sticks.
 */
export function ConfirmButton({
  question,
  confirmLabel,
  onConfirm,
  className,
  title,
  "aria-label": ariaLabel,
  children,
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const groupRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  useEffect(() => {
    if (confirming) groupRef.current?.focus();
  }, [confirming]);

  if (!confirming) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={className}
        title={title}
        aria-label={ariaLabel}
        onClick={() => setConfirming(true)}
      >
        {children}
      </button>
    );
  }

  const cancel = () => {
    setConfirming(false);
    // Hand focus back to the trigger once it re-renders.
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <span
      ref={groupRef}
      className="confirm-button"
      role="group"
      tabIndex={-1}
      aria-labelledby={questionId}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancel();
        }
      }}
      onBlur={(e) => {
        // Leaving the group entirely (not moving between its two buttons)
        // abandons the prompt.
        if (!groupRef.current?.contains(e.relatedTarget as Node | null)) {
          setConfirming(false);
        }
      }}
    >
      <span id={questionId} className="confirm-button__question">
        {question}
      </span>
      <button
        type="button"
        className="confirm-button__confirm"
        onClick={() => {
          setConfirming(false);
          void onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="confirm-button__cancel" onClick={cancel}>
        Cancel
      </button>
    </span>
  );
}

import { describePause, type PauseReason } from "./pause-reason";

interface ContinuePromptProps {
  reason: PauseReason;
  /** Sends "Continue" as a normal user turn, resuming with full history. */
  onContinue: () => void;
  /** Hides the card until the next run ends. */
  onDismiss: () => void;
}

/**
 * The affordance shown when a run ends with work apparently left over.
 *
 * Deliberately a card rather than the one-line italic note it replaces: the
 * complaint it answers is "I barely knew it stopped". It states what
 * happened, offers the single action that resumes, and — for the turn-limit
 * case — names the setting that governs it, so the fix is discoverable
 * without a support question.
 *
 * `role="status"` with `aria-live="polite"` so the pause is announced rather
 * than silently appearing below the fold.
 */
export function ContinuePrompt({ reason, onContinue, onDismiss }: ContinuePromptProps) {
  return (
    <div className="continue-working" role="status" aria-live="polite">
      <button
        type="button"
        className="continue-working__dismiss"
        onClick={onDismiss}
        aria-label="Dismiss"
        title="Dismiss"
      >
        ×
      </button>
      <p className="continue-working__note">{describePause(reason)}</p>
      <button type="button" className="continue-working__btn" onClick={onContinue}>
        Continue Working
      </button>
      <p className="continue-working__hint">
        {reason.kind === "turn-limit"
          ? "Picks up where it left off. Raise the limit in Settings, under “How long the agent works”."
          : "Picks up where it left off, or type what you want next."}
      </p>
    </div>
  );
}

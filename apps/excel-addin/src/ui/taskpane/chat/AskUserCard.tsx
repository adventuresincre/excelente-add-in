import { useEffect, useRef, useState } from "react";
import type {
  AskUserQuestion,
  AskUserResponse,
  PendingAskUserQuestion,
} from "./useAskUserQueue";

interface AskUserCardProps {
  pending: PendingAskUserQuestion;
  onRespond: (response: AskUserResponse) => void;
  onCancel: () => void;
}

/**
 * Inline card that pauses the chat to ask the user 1-4 structured
 * questions ONE AT A TIME. Single-page layout was unusable in the narrow
 * task pane — with three questions stacked vertically the Submit button
 * landed below the fold and the user couldn't reach it. The paginated
 * layout shows one question at a time with Back / Next / Submit buttons
 * always visible inside the visible viewport.
 *
 * State model: keep all answers in shared `picked` / `other` maps keyed
 * by question index so the user can navigate back and forth without
 * losing earlier selections. Submit is only enabled once every question
 * has an answer (a non-empty picked array OR a non-empty other text).
 */
export function AskUserCard({ pending, onRespond, onCancel }: AskUserCardProps) {
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [other, setOther] = useState<Record<number, string>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  const total = pending.questions.length;
  const isFirst = currentIdx === 0;
  const isLast = currentIdx === total - 1;

  const setSingle = (qIdx: number, label: string) => {
    setPicked((p) => ({ ...p, [qIdx]: [label] }));
    setOther((o) => ({ ...o, [qIdx]: "" }));
  };

  const toggleMulti = (qIdx: number, label: string) => {
    setPicked((p) => {
      const current = p[qIdx] ?? [];
      const next = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
      return { ...p, [qIdx]: next };
    });
    setOther((o) => ({ ...o, [qIdx]: "" }));
  };

  const setOtherText = (qIdx: number, text: string) => {
    setOther((o) => ({ ...o, [qIdx]: text }));
    setPicked((p) => ({ ...p, [qIdx]: [] }));
  };

  // Whether a given question has any answer (option picked OR free text).
  const isAnswered = (qIdx: number) => {
    const text = other[qIdx]?.trim();
    if (text) return true;
    const opts = picked[qIdx];
    return Boolean(opts && opts.length > 0);
  };

  // Submit only enabled when EVERY question has an answer. Same rule as
  // before — pagination doesn't change validation, just how the user
  // navigates through it.
  const canSubmit = pending.questions.every((_, qIdx) => isAnswered(qIdx));
  // Next is enabled when the CURRENT question is answered. Encourages
  // forward motion without letting the user skip questions blank.
  const canNext = isAnswered(currentIdx);

  const submit = () => {
    const answers: AskUserResponse["answers"] = pending.questions.map((_, qIdx) => {
      const text = other[qIdx]?.trim();
      if (text) return { text };
      return { picked: picked[qIdx] ?? [] };
    });
    onRespond({ answers });
  };

  const q = pending.questions[currentIdx];

  // Same reasoning as ApprovalCard: this card blocks the agent until it is
  // answered, and it appears at the end of a potentially long transcript.
  // Without moving focus, a keyboard user has no way to know the agent is
  // waiting on them. Focus the card itself rather than the first control so
  // the question is announced before any answer can be selected.
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    cardRef.current?.focus();
    return () => {
      if (cardRef.current?.contains(document.activeElement)) {
        previouslyFocused?.focus?.();
      }
    };
  }, [pending.id]);

  return (
    <div
      ref={cardRef}
      className="ask-user-card"
      role="dialog"
      tabIndex={-1}
      aria-label="Question from the agent"
    >
      <div className="ask-user-card__header">
        <span className="ask-user-card__icon" aria-hidden="true">
          ❓
        </span>
        <span className="ask-user-card__title">
          {total === 1 ? "One question" : `Question ${currentIdx + 1} of ${total}`}
        </span>
        {total > 1 && (
          <ol className="ask-user-card__progress" aria-hidden="true">
            {pending.questions.map((_, i) => (
              <li
                key={i}
                className={
                  i === currentIdx
                    ? "ask-user-card__progress-dot is-active"
                    : isAnswered(i)
                      ? "ask-user-card__progress-dot is-done"
                      : "ask-user-card__progress-dot"
                }
              />
            ))}
          </ol>
        )}
      </div>

      <QuestionBlock
        q={q}
        qIdx={currentIdx}
        pickedHere={picked[currentIdx] ?? []}
        otherHere={other[currentIdx] ?? ""}
        onSingle={(label) => setSingle(currentIdx, label)}
        onMulti={(label) => toggleMulti(currentIdx, label)}
        onOther={(text) => setOtherText(currentIdx, text)}
      />

      <div className="ask-user-card__actions">
        <button type="button" className="ask-user-card__skip" onClick={onCancel}>
          Skip
        </button>
        <div className="ask-user-card__nav">
          {!isFirst && (
            <button
              type="button"
              className="ask-user-card__back"
              onClick={() => setCurrentIdx((i) => i - 1)}
            >
              Back
            </button>
          )}
          {!isLast && (
            <button
              type="button"
              className="ask-user-card__next"
              onClick={() => setCurrentIdx((i) => i + 1)}
              disabled={!canNext}
            >
              Next
            </button>
          )}
          {isLast && (
            <button
              type="button"
              className="ask-user-card__submit"
              onClick={submit}
              disabled={!canSubmit}
            >
              Submit
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QuestionBlock({
  q,
  qIdx,
  pickedHere,
  otherHere,
  onSingle,
  onMulti,
  onOther,
}: {
  q: AskUserQuestion;
  qIdx: number;
  pickedHere: string[];
  otherHere: string;
  onSingle: (label: string) => void;
  onMulti: (label: string) => void;
  onOther: (text: string) => void;
}) {
  return (
    <div className="ask-user-card__question">
      {q.header && <div className="ask-user-card__chip">{q.header}</div>}
      <div className="ask-user-card__prompt" id={`ask-prompt-${qIdx}`}>
        {q.question}
      </div>
      {/* Selection was conveyed ONLY by the ☑/● glyph, so assistive tech had
          no way to report which option was chosen. radio/checkbox roles put
          that state in the accessibility tree. */}
      <ul
        className="ask-user-card__options"
        role={q.multiSelect ? "group" : "radiogroup"}
        aria-labelledby={`ask-prompt-${qIdx}`}
      >
        {q.options.map((opt) => {
          const selected = pickedHere.includes(opt.label);
          return (
            <li key={opt.label} role="presentation">
              <button
                type="button"
                role={q.multiSelect ? "checkbox" : "radio"}
                aria-checked={selected}
                className={`ask-user-card__option${selected ? " is-selected" : ""}`}
                onClick={() =>
                  q.multiSelect ? onMulti(opt.label) : onSingle(opt.label)
                }
              >
                <span className="ask-user-card__option-marker" aria-hidden="true">
                  {q.multiSelect ? (selected ? "☑" : "☐") : selected ? "●" : "○"}
                </span>
                <span className="ask-user-card__option-body">
                  <span className="ask-user-card__option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="ask-user-card__option-desc">{opt.description}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <input
        type="text"
        className="ask-user-card__other"
        placeholder="Other (free text)…"
        value={otherHere}
        onChange={(e) => onOther(e.target.value)}
        aria-label={`Free-text answer for question ${qIdx + 1}`}
      />
    </div>
  );
}

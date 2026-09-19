import type { ReactNode } from "react";
import "./system-notice.css";

/**
 * One card for every message Excelente sends on its own behalf.
 *
 * Approved design, Spencer 2026-09-15: a tester read the old red error card
 * as "Excelente is broken" when the pane was doing its job (relaying an
 * OpenRouter balance check). The notice looks like the product, not like the
 * model and not like an alarm. It says three things in order: what stopped,
 * why, and what to do. Red is reserved for a notice whose body says work was
 * lost, and none of the current messages qualify, so there is no red variant.
 *
 * The eyebrow carries the wordmark, the product name and one of four state
 * words. That line is what tells a reader the AI did not write this.
 */
export type SystemNoticeState = "needs-you" | "our-side" | "stopped" | "waiting";

const STATE_LABEL: Record<SystemNoticeState, string> = {
  "needs-you": "Paused, needs you",
  "our-side": "Paused, our side",
  stopped: "Stopped",
  waiting: "Waiting on you",
};

export interface SystemNoticeProps {
  state: SystemNoticeState;
  /** One plain sentence, the fact. Rendered in the brand serif. */
  title: string;
  /** At most two sentences: the mechanism in the user's words, then what did and did not happen. */
  children?: ReactNode;
  /** Buttons. One dark for the fix, one quiet to resume. Never a bare URL in the body. */
  actions?: ReactNode;
  /** Optional: the one thing that prevents a repeat. */
  footnote?: ReactNode;
  className?: string;
}

export function SystemNotice({
  state,
  title,
  children,
  actions,
  footnote,
  className,
}: SystemNoticeProps) {
  return (
    <div className={`system-notice${className ? ` ${className}` : ""}`} role="status">
      <div className="system-notice__eyebrow">
        <img
          src="/assets/logo-filled.png"
          alt=""
          aria-hidden="true"
          className="system-notice__mark"
          width={14}
          height={14}
        />
        <span>Excelente</span>
        <span className="system-notice__sep" aria-hidden="true">
          ·
        </span>
        <span className="system-notice__state">{STATE_LABEL[state]}</span>
      </div>
      <p className="system-notice__title">{title}</p>
      {children && <div className="system-notice__body">{children}</div>}
      {actions && <div className="system-notice__actions">{actions}</div>}
      {footnote && <p className="system-notice__foot">{footnote}</p>}
    </div>
  );
}

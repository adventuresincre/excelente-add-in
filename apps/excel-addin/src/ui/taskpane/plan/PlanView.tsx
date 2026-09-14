import type { PlanStep, PlanStepStatus } from "../../../core/tools";
import "./plan.css";

interface PlanViewProps {
  /** Most recent plan submitted in this chat. Null when no plan exists. */
  plan: {
    planId: string;
    steps: PlanStep[];
  } | null;
  /** Back to chat. */
  onBack: () => void;
  /** Switch to Work mode and run the plan. Only meaningful pre-execution. */
  onPromoteToWork: () => void;
  /** Spawn a reviewer sub-agent. Only meaningful pre-execution. */
  onRequestReview: () => void;
}

const STATUS_LABELS: Record<PlanStepStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  done: "Done",
  blocked: "Blocked",
};

/**
 * Dedicated Plan tab body. The chat stream now shows a compact PlanPill as
 * a breadcrumb; this view is where the user actually reviews / promotes /
 * critiques the plan. Layout mirrors the editorial PlanCard but uses the
 * full pane width so longer step bodies and notes have room to breathe.
 */
export function PlanView({ plan, onBack, onPromoteToWork, onRequestReview }: PlanViewProps) {
  if (!plan) {
    return (
      <div className="plan-view plan-view--empty">
        <h2 className="plan-view__title">
          No plan <em className="accent">yet</em>.
        </h2>
        <p className="plan-view__hint">
          Switch the chat to <strong>Plan</strong> mode and ask for something planning-shaped
          (a multi-step model build, a refactor, a workbook audit). The agent will submit a
          structured plan that lands here for review.
        </p>
        <button type="button" className="btn-secondary" onClick={onBack}>
          ← Back to chat
        </button>
      </div>
    );
  }

  const total = plan.steps.length;
  const done = plan.steps.filter((s) => s.status === "done").length;
  const anyProgress = plan.steps.some((s) => s.status !== "pending");
  const progressPct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="plan-view">
      <header className="plan-view__header">
        <div className="plan-view__heading">
          <h2 className="plan-view__label">PLAN</h2>
          <span className="plan-view__id" title={plan.planId}>{plan.planId}</span>
        </div>
        <button type="button" className="plan-view__back" onClick={onBack}>
          ← Back to chat
        </button>
      </header>

      {/* The wrapper carried an aria-label, which ARIA prohibits on a
          roleless <div> — so the name was dropped and the progressbar
          itself was left unnamed. The name now lives on the progressbar,
          and aria-valuemax is floored at 1 because a max equal to min
          (an empty plan) is an invalid range. */}
      <div className="plan-view__progress">
        <div
          className="plan-view__progress-track"
          role="progressbar"
          aria-label="Plan progress"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={Math.max(total, 1)}
          aria-valuetext={`${done} of ${total} steps complete`}
        >
          <div className="plan-view__progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
        <span className="plan-view__progress-label">
          {done} of {total} done
        </span>
      </div>

      <ol className="plan-view__steps">
        {plan.steps.map((step) => (
          <li
            key={step.number}
            className={`plan-view__step plan-view__step--${step.status}`}
          >
            <span className="plan-view__step-marker" aria-hidden="true">
              {step.status === "done"
                ? "✓"
                : step.status === "in-progress"
                  ? "▶"
                  : step.status === "blocked"
                    ? "✕"
                    : "○"}
            </span>
            <span className="plan-view__step-num">{step.number}</span>
            <div className="plan-view__step-body">
              <div className="plan-view__step-title-row">
                <span className="plan-view__step-title">{step.title}</span>
                <span className={`plan-view__chip plan-view__chip--${step.status}`}>
                  {STATUS_LABELS[step.status]}
                </span>
              </div>
              {step.details && <p className="plan-view__step-details">{step.details}</p>}
              {step.note && step.status === "blocked" && (
                <p className="plan-view__step-note">Blocker: {step.note}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {!anyProgress && (
        <div className="plan-view__actions">
          <button
            type="button"
            className="plan-view__promote"
            onClick={onPromoteToWork}
          >
            Promote to Work →
          </button>
          <button
            type="button"
            className="plan-view__review"
            onClick={onRequestReview}
            title="Spawn a reviewer sub-agent to critique this plan"
          >
            Request review
          </button>
          <span className="plan-view__action-hint">
            Promote switches to Work mode and asks the agent to execute the plan.
          </span>
        </div>
      )}
    </div>
  );
}

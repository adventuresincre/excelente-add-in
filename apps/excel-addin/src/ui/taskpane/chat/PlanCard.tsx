import type { PlanStep, PlanStepStatus } from "../../../core/tools";

interface PlanCardProps {
  planId: string;
  steps: PlanStep[];
  /**
   * Shown only when there's a meaningful action to take. The chat panel
   * passes a handler when the plan is "fresh" (no progress yet); after the
   * agent starts executing, the button hides itself.
   */
  onPromoteToWork?: () => void;
  /**
   * Spawn a reviewer sub-agent that critiques the plan. The result lands as
   * a normal assistant bubble in the chat. Only offered before execution
   * begins — once a step is in-progress the plan is no longer the
   * "current draft" worth re-reviewing.
   */
  onRequestReview?: () => void;
}

const STATUS_LABELS: Record<PlanStepStatus, string> = {
  pending: "Pending",
  "in-progress": "In progress",
  done: "Done",
  blocked: "Blocked",
};

/**
 * Plan card — renders the structured plan the agent submitted via
 * `submit_plan`, with one chip per step that the `update_plan_step` tool
 * mutates as the agent executes. Looks like an editorial sidebar block:
 * gold accent border, numbered steps, dimmed details, status chip on the
 * right. The "Promote to Work" button is the only call-to-action.
 */
export function PlanCard({
  planId,
  steps,
  onPromoteToWork,
  onRequestReview,
}: PlanCardProps) {
  const anyProgress = steps.some((s) => s.status !== "pending");

  return (
    <div className="plan-card" role="region" aria-label="Plan">
      <header className="plan-card__header">
        <span className="plan-card__title">Plan</span>
        <span className="plan-card__id" title={planId}>
          {planId}
        </span>
      </header>
      <ol className="plan-card__steps">
        {steps.map((step) => (
          <li
            key={step.number}
            className={`plan-card__step plan-card__step--${step.status}`}
          >
            <span className="plan-card__step-num">{step.number}</span>
            <span className="plan-card__step-body">
              <span className="plan-card__step-title">{step.title}</span>
              {step.details && (
                <span className="plan-card__step-details">{step.details}</span>
              )}
              {step.note && step.status === "blocked" && (
                <span className="plan-card__step-note">Blocker: {step.note}</span>
              )}
            </span>
            <span className={`plan-card__chip plan-card__chip--${step.status}`}>
              {STATUS_LABELS[step.status]}
            </span>
          </li>
        ))}
      </ol>
      {!anyProgress && (onPromoteToWork || onRequestReview) && (
        <div className="plan-card__actions">
          {onPromoteToWork && (
            <button
              type="button"
              className="plan-card__promote"
              onClick={onPromoteToWork}
            >
              Promote to Work →
            </button>
          )}
          {onRequestReview && (
            <button
              type="button"
              className="plan-card__review"
              onClick={onRequestReview}
              title="Spawn a reviewer sub-agent to critique this plan"
            >
              Request review
            </button>
          )}
          {onPromoteToWork && (
            <span className="plan-card__action-hint">
              Promote switches to Work mode and asks the agent to execute the plan.
            </span>
          )}
        </div>
      )}
    </div>
  );
}

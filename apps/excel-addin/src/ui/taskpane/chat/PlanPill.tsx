import type { PlanStep } from "../../../core/tools";

interface PlanPillProps {
  planId: string;
  steps: PlanStep[];
  /** Click handler — opens the plan sheet over the chat. */
  onOpen: () => void;
  /** True while the plan sheet is open, so the chevron points down. */
  expanded?: boolean;
}

/**
 * Compact inline placeholder that replaces the full PlanCard in the chat
 * stream. Shows aggregate progress + the current step, takes one row of
 * vertical space, and routes to the Plan tab on click. Mirrors the
 * convention of `details > summary` — the chat keeps a small breadcrumb,
 * the full plan view lives on its own tab.
 */
export function PlanPill({ planId, steps, onOpen, expanded = false }: PlanPillProps) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "done").length;
  const active = steps.find((s) => s.status === "in-progress");
  const blocked = steps.find((s) => s.status === "blocked");

  let detail: string;
  if (blocked) {
    detail = `Blocked at step ${blocked.number}`;
  } else if (active) {
    detail = `Step ${active.number}: ${active.title}`;
  } else if (done === total) {
    detail = "All steps complete";
  } else {
    detail = "Awaiting promotion";
  }

  return (
    <button
      type="button"
      className={`plan-pill plan-pill--${blocked ? "blocked" : active ? "active" : done === total ? "done" : "pending"}`}
      onClick={onOpen}
      title={`Open plan ${planId}`}
      aria-expanded={expanded}
    >
      <span className="plan-pill__icon" aria-hidden="true">📋</span>
      <span className="plan-pill__label">Plan</span>
      <span className="plan-pill__progress">
        {done}/{total}
      </span>
      <span className="plan-pill__detail">{detail}</span>
      <span className="plan-pill__chevron" aria-hidden="true">
        {expanded ? "▾" : "▸"}
      </span>
    </button>
  );
}

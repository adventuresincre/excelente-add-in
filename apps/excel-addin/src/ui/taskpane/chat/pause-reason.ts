import type { TodoItem, TurnItem } from "./useAgentStream";

/**
 * Why a finished run might not actually be finished.
 *
 * A run can end two ways that leave work on the table, and until now only
 * the first was visible to the user:
 *
 *  - `turn-limit` — the orchestrator exhausted the per-send turn cap and
 *    yielded `finishReason: "max-turns"`. Unambiguous: the agent was still
 *    mid-job when the ceiling stopped it.
 *  - `open-tasks` — the run ended normally (the model simply stopped asking
 *    for tools) but its own checklist still has unticked items. The model
 *    gave up, or narrated a hand-off instead of continuing. This is by far
 *    the more common way a long build trails off, and it produced no signal
 *    at all before: the typing indicator vanished and the composer came
 *    back, which is indistinguishable from "done".
 *
 * `open-tasks` reports the checklist, not a judgement about whether the
 * model was really finished — the copy says how many items are open and
 * lets the user decide. A model that forgets to tick its last item is a
 * false positive we accept; the card is dismissible for exactly that case.
 */
export type PauseReason =
  | { kind: "turn-limit"; steps: number | null }
  | { kind: "open-tasks"; open: number; total: number };

/** The task list the agent is keeping, or null if it never opened one. */
function latestTodo(items: readonly TurnItem[]): TodoItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.kind === "todo") return item;
  }
  return null;
}

/**
 * Decide what — if anything — to offer the user after a run ends.
 *
 * Pure and derived rather than stored: the inputs are the run's finish
 * reason and the transcript, both of which the panel already holds, so the
 * notice cannot drift out of sync with what is on screen.
 *
 * @param hitTurnLimit the last run ended with `finishReason: "max-turns"`
 * @param items the transcript as rendered
 * @param maxTurns the cap in force, for the copy; null when unknown
 */
export function pauseReasonFor(
  hitTurnLimit: boolean,
  items: readonly TurnItem[],
  maxTurns: number | null = null
): PauseReason | null {
  // The turn cap is the stronger, unambiguous signal — report it even when
  // the checklist also has open items, because it explains *why* they are
  // open. Naming the ceiling is what turns a mysterious stop into a setting
  // the user can change.
  if (hitTurnLimit) {
    return { kind: "turn-limit", steps: maxTurns && maxTurns > 0 ? maxTurns : null };
  }

  const todo = latestTodo(items);
  if (!todo || todo.tasks.length === 0) return null;
  const open = todo.tasks.filter((t) => t.status !== "done").length;
  if (open === 0) return null;
  return { kind: "open-tasks", open, total: todo.tasks.length };
}

/**
 * One sentence of plain language for the notice. No jargon: the user never
 * sees "turns", "tool calls" or "finish reason" — only what happened and
 * what they can do about it.
 */
export function describePause(reason: PauseReason): string {
  // Kept short on purpose: the pane is ~320px wide, and a notice that wraps
  // to four lines reads as an error. Where the limit is changed belongs in
  // the card's hint line, not here.
  if (reason.kind === "turn-limit") {
    return reason.steps === null
      ? "Excelente paused at its step limit for one message. Nothing it has done is lost."
      : `Excelente paused after ${reason.steps} steps, its limit for one message. Nothing it has done is lost.`;
  }
  const { open, total } = reason;
  const items = open === 1 ? "task is" : "tasks are";
  return `Excelente stopped with ${open} of ${total} ${items} still open on its checklist.`;
}

import { describe, expect, it } from "vitest";
import { describePause, pauseReasonFor } from "./pause-reason";
import type { TurnItem } from "./useAgentStream";

function todo(...statuses: Array<"pending" | "in-progress" | "done">): TurnItem {
  return {
    kind: "todo",
    id: "todo-1",
    callId: "call-1",
    tasks: statuses.map((status, i) => ({ text: `task ${i + 1}`, status })),
  };
}

function assistant(content: string): TurnItem {
  return { kind: "assistant", id: `a-${content}`, content, isStreaming: false };
}

describe("pauseReasonFor", () => {
  it("offers nothing when the run finished cleanly with no checklist", () => {
    expect(pauseReasonFor(false, [assistant("All set.")])).toBeNull();
  });

  it("offers nothing when every task is ticked", () => {
    expect(pauseReasonFor(false, [todo("done", "done")])).toBeNull();
  });

  it("reports the turn cap, naming the limit in force", () => {
    expect(pauseReasonFor(true, [assistant("…")], 200)).toEqual({
      kind: "turn-limit",
      steps: 200,
    });
  });

  it("omits the number when the cap is unknown or nonsensical", () => {
    expect(pauseReasonFor(true, [], null)).toEqual({ kind: "turn-limit", steps: null });
    expect(pauseReasonFor(true, [], 0)).toEqual({ kind: "turn-limit", steps: null });
  });

  it("prefers the turn cap over open tasks — it explains why they are open", () => {
    const reason = pauseReasonFor(true, [todo("done", "pending", "pending")], 100);
    expect(reason).toEqual({ kind: "turn-limit", steps: 100 });
  });

  it("counts pending and in-progress alike as open work", () => {
    expect(pauseReasonFor(false, [todo("done", "in-progress", "pending")])).toEqual({
      kind: "open-tasks",
      open: 2,
      total: 3,
    });
  });

  it("reads the most recent checklist, not an earlier one", () => {
    const items: TurnItem[] = [
      { ...(todo("pending", "pending") as Extract<TurnItem, { kind: "todo" }>), id: "old" },
      { ...(todo("done", "done") as Extract<TurnItem, { kind: "todo" }>), id: "new" },
    ];
    expect(pauseReasonFor(false, items)).toBeNull();
  });

  it("ignores an empty checklist", () => {
    expect(pauseReasonFor(false, [todo()])).toBeNull();
  });
});

describe("describePause", () => {
  it("names the step limit it reached", () => {
    const text = describePause({ kind: "turn-limit", steps: 200 });
    expect(text).toContain("after 200 steps");
  });

  it("still explains the pause when the limit is unknown", () => {
    const text = describePause({ kind: "turn-limit", steps: null });
    expect(text).toContain("step limit");
    expect(text).not.toContain("null");
  });

  // The pane is narrow; a notice that wraps to four lines reads as an error.
  it("keeps every notice short enough for a 320px pane", () => {
    const texts = [
      describePause({ kind: "turn-limit", steps: 200 }),
      describePause({ kind: "turn-limit", steps: null }),
      describePause({ kind: "open-tasks", open: 3, total: 7 }),
    ];
    for (const t of texts) expect(t.length).toBeLessThanOrEqual(110);
  });

  it("counts open tasks, agreeing in number", () => {
    expect(describePause({ kind: "open-tasks", open: 1, total: 4 })).toContain(
      "1 of 4 task is still open"
    );
    expect(describePause({ kind: "open-tasks", open: 3, total: 4 })).toContain(
      "3 of 4 tasks are still open"
    );
  });

  it("never mentions turns, tool calls or finish reasons", () => {
    const texts = [
      describePause({ kind: "turn-limit", steps: 50 }),
      describePause({ kind: "open-tasks", open: 2, total: 5 }),
    ];
    for (const t of texts) {
      expect(t.toLowerCase()).not.toMatch(/turn|tool call|finish reason/);
    }
  });
});

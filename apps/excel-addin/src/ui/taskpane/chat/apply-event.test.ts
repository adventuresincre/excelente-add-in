import { describe, expect, it } from "vitest";
import { applyEvent } from "./useAgentStream";

type Items = ReturnType<typeof applyEvent>;
type Event = Parameters<typeof applyEvent>[1];

function run(events: Event[]): Items {
  return events.reduce<Items>((items, e) => applyEvent(items, e), []);
}

/** A retry for the reported failure: a saturated shared NVIDIA worker pool. */
const busy = (attempt: number, discard?: { text: number; reasoning: number }): Event => ({
  type: "stream-retry",
  attempt,
  maxAttempts: 5,
  error: "ResourceExhausted: Worker local total request limit reached (16/16)",
  reason: "capacity",
  ...(discard ? { discard } : {}),
});

describe("applyEvent — stream-retry", () => {
  it("drops the partial output of the failed attempt so the replay is not duplicated", () => {
    const items = run([
      { type: "reasoning-delta", text: "thinking" },
      { type: "text-delta", text: "partial " },
      busy(1, { text: "partial ".length, reasoning: "thinking".length }),
      { type: "text-delta", text: "whole answer" },
      { type: "done", finishReason: "stop" },
    ]);

    const assistants = items.filter((it) => it.kind === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).toMatchObject({ content: "whole answer", isStreaming: false });
    expect(assistants[0]).not.toHaveProperty("reasoning", "thinking");

    const noticeIdx = items.findIndex((it) => it.kind === "system");
    const answerIdx = items.findIndex((it) => it.kind === "assistant");
    expect(items[noticeIdx]).toMatchObject({
      kind: "system",
      title: "Provider is busy, retrying (1/5)",
    });
    // The notice sits above the recovered answer, where the wait happened.
    expect(noticeIdx).toBeLessThan(answerIdx);
  });

  it("trims only what the attempt streamed", () => {
    // Defensive: the orchestrator never appends to a sealed item, but a
    // length-based trim must not eat content it was not told to.
    const items = run([
      { type: "text-delta", text: "kept " },
      { type: "text-delta", text: "gone" },
      busy(1, { text: "gone".length, reasoning: 0 }),
    ]);
    expect(items[0]).toMatchObject({ kind: "assistant", content: "kept " });
  });

  it("collapses successive retries into one updating notice", () => {
    const items = run([
      busy(1),
      { type: "text-delta", text: "half" },
      busy(2, { text: 4, reasoning: 0 }),
      busy(3),
    ]);
    const notices = items.filter((it) => it.kind === "system");
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ title: "Provider is busy, retrying (3/5)" });
    expect(items.some((it) => it.kind === "assistant")).toBe(false);
  });

  it("words the notice by reason", () => {
    const network = run([
      {
        type: "stream-retry",
        attempt: 1,
        maxAttempts: 5,
        error: "fetch failed",
        reason: "network",
      },
    ]);
    expect(network[0]).toMatchObject({ title: "Connection problem, retrying (1/5)" });
    const provider = run([
      { type: "stream-retry", attempt: 2, maxAttempts: 5, error: "502", reason: "provider" },
    ]);
    expect(provider[0]).toMatchObject({ title: "Provider error, retrying (2/5)" });
  });
});

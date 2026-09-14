import type { TurnItem } from "./useAgentStream";

interface TypingIndicatorProps {
  /** Most recent turn item — used to derive what phase the agent is in. */
  lastItem: TurnItem | undefined;
}

/**
 * Pulsing-dots indicator shown at the bottom of the message list whenever
 * the agent is doing something. Mirrors Claude Code's "still working" pulse
 * so the user knows the harness hasn't silently stalled.
 *
 * Suppressed when the latest item is a streaming assistant bubble — the
 * cursor on the bubble already shows live progress, and a second indicator
 * below would just be visual noise.
 */
export function TypingIndicator({ lastItem }: TypingIndicatorProps) {
  // Don't double up with the streaming-cursor on the bubble.
  if (
    lastItem &&
    lastItem.kind === "assistant" &&
    "isStreaming" in lastItem &&
    lastItem.isStreaming
  ) {
    return null;
  }

  const label = labelFor(lastItem);

  return (
    <div className="typing-indicator" role="status" aria-live="polite">
      <svg
        className="typing-indicator__logo"
        viewBox="0 0 100 100"
        width="20"
        height="20"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Logo body — static. The animation lives on the three squares so
            the brand mark is the indicator itself, not a generic pulse. */}
        <path
          d="M 28 22 L 78 22 L 72 33 L 42 33 L 42 67 L 72 67 L 78 78 L 28 78 Z"
          fill="currentColor"
        />
        <rect x="46" y="46" width="7" height="8" fill="currentColor" />
        <rect x="56" y="46" width="7" height="8" fill="currentColor" />
        <rect x="66" y="46" width="7" height="8" fill="currentColor" />
      </svg>
      <span className="typing-indicator__label">{label}</span>
    </div>
  );
}

/**
 * Pick a status string based on the latest turn item — so the user can tell
 * the difference between "model is thinking", "tool is running", and
 * "subagent is working." Conservative when the kind is ambiguous.
 */
function labelFor(item: TurnItem | undefined): string {
  if (!item) return "Thinking…";
  switch (item.kind) {
    case "tool":
      // Show the tool name when we have it — "Running write_range…" reads
      // better than a generic "Working…" and tells the user something
      // useful (e.g., a screenshot capture is slower than a read).
      return item.toolName ? `Running ${item.toolName}…` : "Working…";
    case "user":
      return "Thinking…";
    case "plan":
      return "Drafting plan…";
    case "todo":
      return "Updating tasks…";
    case "assistant":
      return "Thinking…";
    default:
      return "Working…";
  }
}

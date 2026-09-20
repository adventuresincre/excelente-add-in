import type { ReactNode } from "react";
import { SystemNotice } from "../SystemNotice";
import type { PendingReason } from "./pending-model";
import "./pending-model.css";

export interface PendingModelNoticeProps {
  /** Readable name of the waiting model, e.g. "Claude Opus 5". */
  modelName: string;
  /** Where the notice sits; the wording differs slightly by surface. */
  surface: "chat" | "settings";
  /** Why the model waits: no key for it, or no membership for it. */
  reason: PendingReason;
  onAddKey: () => void;
  /** Bring the edition's membership controls into view. Required for "membership". */
  onConnectMembership?: () => void;
  /**
   * The edition's keyless fallback, named live (a hosted tier shows the
   * model it is pinned to right now). Omit both when the edition has none
   * or the user is not entitled to it: the notice then offers the key alone.
   */
  fallbackName?: ReactNode;
  onUseFallback?: () => void;
}

/**
 * The waiting-model notice, shown under the picker in Settings and at the
 * foot of the chat transcript. Same card, same actions; only the lead
 * sentence changes so each surface reads naturally in place. While it shows,
 * the composer is locked (Spencer, 2026-09-15): the buttons are the only
 * ways forward, and nothing is sent to any model until one is pressed.
 */
export function PendingModelNotice({
  modelName,
  surface,
  reason,
  onAddKey,
  onConnectMembership,
  fallbackName,
  onUseFallback,
}: PendingModelNoticeProps) {
  if (reason === "membership") {
    return (
      <SystemNotice
        state="needs-you"
        title={
          surface === "settings"
            ? `Saved. ${modelName} needs a connected membership to run.`
            : `${modelName} needs a connected membership to run.`
        }
        className="pending-model-notice"
        actions={
          <>
            <button
              type="button"
              className="system-notice__btn system-notice__btn--dark"
              onClick={onConnectMembership}
            >
              Connect membership
            </button>
            <button
              type="button"
              className="system-notice__btn system-notice__btn--quiet"
              onClick={onAddKey}
            >
              Add OpenRouter key
            </button>
          </>
        }
      >
        <p>
          Connect CRE Agents or the A.CRE Intelligence Hub and it answers your next message. Or add
          your own OpenRouter key and choose any model. Chat is paused until you do one of them.
        </p>
      </SystemNotice>
    );
  }

  const hasFallback = Boolean(onUseFallback);
  const title =
    surface === "settings"
      ? `Saved. ${modelName} needs an OpenRouter key to run.`
      : `${modelName} needs an OpenRouter key to run.`;
  return (
    <SystemNotice
      state="needs-you"
      title={title}
      className="pending-model-notice"
      actions={
        <>
          <button
            type="button"
            className="system-notice__btn system-notice__btn--dark"
            onClick={onAddKey}
          >
            Add OpenRouter key
          </button>
          {hasFallback && (
            <button
              type="button"
              className="system-notice__btn system-notice__btn--quiet"
              onClick={onUseFallback}
            >
              Stay on {fallbackName}
            </button>
          )}
        </>
      }
    >
      {surface === "settings" ? (
        <p>
          Add a key and it answers your next message.
          {hasFallback && <> Alternatively, stay on {fallbackName}.</>} Chat is paused until{" "}
          {hasFallback ? "you choose one" : "then"}. You pay OpenRouter directly for what you use;
          Excelente takes nothing.
        </p>
      ) : (
        <p>
          Add a key and {modelName} answers your next message.
          {hasFallback && (
            <> Alternatively, stay on {fallbackName} and keep working without a key.</>
          )}
        </p>
      )}
    </SystemNotice>
  );
}

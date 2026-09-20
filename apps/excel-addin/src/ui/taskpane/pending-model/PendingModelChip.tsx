import type { PendingReason } from "./pending-model";
import "./pending-model.css";

export interface PendingModelChipProps {
  modelName: string;
  reason: PendingReason;
  onOpenSettings: () => void;
}

/**
 * The cue beside the composer's Plan/Work pill while a chosen model waits
 * and the composer is locked. Opens Settings.
 */
export function PendingModelChip({ modelName, reason, onOpenSettings }: PendingModelChipProps) {
  const need = reason === "membership" ? "a membership" : "a key";
  return (
    <button
      type="button"
      className="pending-model-chip"
      onClick={onOpenSettings}
      title={
        reason === "membership"
          ? `${modelName} needs a connected membership. Open Settings to connect one or switch model.`
          : `${modelName} needs an OpenRouter key. Open Settings to add one or switch model.`
      }
    >
      <span className="pending-model-chip__lock" aria-hidden="true" />
      <span className="pending-model-chip__text">
        {modelName} needs {need}
      </span>
    </button>
  );
}

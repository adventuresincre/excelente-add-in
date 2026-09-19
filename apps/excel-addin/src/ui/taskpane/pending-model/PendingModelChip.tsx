import "./pending-model.css";

export interface PendingModelChipProps {
  modelName: string;
  onOpenSettings: () => void;
}

/**
 * The cue beside the composer's Plan/Work pill while a chosen model waits on
 * a key and the composer is locked. Opens Settings.
 */
export function PendingModelChip({ modelName, onOpenSettings }: PendingModelChipProps) {
  return (
    <button
      type="button"
      className="pending-model-chip"
      onClick={onOpenSettings}
      title={`${modelName} needs an OpenRouter key. Open Settings to add one or switch model.`}
    >
      <span className="pending-model-chip__lock" aria-hidden="true" />
      <span className="pending-model-chip__text">{modelName} needs a key</span>
    </button>
  );
}

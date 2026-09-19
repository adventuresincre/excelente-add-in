import type { ModelInfo } from "../../../core/openrouter";
import { useHostedPickerRows } from "@edition";
import {
  buildPicker,
  labelForPickerModel,
  pickerOptionModelId,
  pickerOptionValue,
} from "./model-grouping";

export interface ModelPickerProps {
  models: ModelInfo[];
  value: string | null;
  onChange: (modelId: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  /**
   * Accessible name for the select. Required because the visible label is a
   * section heading elsewhere in the DOM, so the control has no name of its
   * own — an unnamed <select> is an automated-check failure (WCAG 4.1.2).
   */
  ariaLabel?: string;
  /** Placeholder when nothing is selected yet. */
  placeholder?: string;
}

export function ModelPicker({
  models,
  value,
  onChange,
  loading,
  error,
  disabled,
  ariaLabel = "Model",
  placeholder = "Choose a model to start…",
}: ModelPickerProps) {
  // The edition's own rows, with their live labels (a hosted tier names the
  // model it is pinned to right now, fetched at runtime because the host
  // changes it without rebuilding the pane). Empty in the community
  // edition. Hook call stays above the `loading` early return — hooks
  // cannot be conditional.
  const hosted = useHostedPickerRows();

  if (loading) {
    return <div className="model-picker model-picker--loading">Loading models…</div>;
  }

  // Hosted rows are injected even when the OpenRouter list is empty (no key
  // yet) or failed to load (bad key) — they need no list, so a failed fetch
  // must never take them down with it.
  const { groups, ranks } = buildPicker(error ? [] : models, undefined, { hosted });
  const known = new Set(groups.flatMap((g) => g.models.map((m) => m.id)));
  const orphan = value && !known.has(value) ? value : null;

  return (
    <>
      {/* The stored value is always the bare model id, which matches the
          option in the model's lab group; a pick from a Top 10 group is
          decoded to that id, so the select then shows the lab entry. */}
      <select
        className="model-picker"
        aria-label={ariaLabel}
        value={value ?? ""}
        onChange={(e) => onChange(pickerOptionModelId(e.target.value))}
        disabled={disabled}
      >
        {!value && <option value="">{placeholder}</option>}
        {/* A stored model that is no longer listed (older than the picker's
            window, retired, or the list failed to load) must still display
            AS ITSELF. Without this a controlled <select> silently shows the
            first option while chat keeps using the old model. */}
        {orphan && (
          <option value={orphan} disabled>
            {orphan} (not in current list)
          </option>
        )}
        {groups.map((g) => (
          <optgroup key={g.key} label={g.label}>
            {g.models.map((m) => (
              <option key={m.id} value={pickerOptionValue(g, m)}>
                {labelForPickerModel(m, ranks, g.labelStyle)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {error && (
        <div className="model-picker model-picker--error" role="alert">
          Couldn&apos;t load OpenRouter models: {error}
        </div>
      )}
    </>
  );
}

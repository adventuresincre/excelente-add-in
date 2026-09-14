import type { ReasoningLevel } from "../../../core/storage";
import type { ModelInfo, ReasoningStop } from "../../../core/openrouter";
import { reasoningIsMandatory, reasoningStopsFor } from "../../../core/openrouter";

const LEVELS: { value: ReasoningLevel; label: string; description: string }[] = [
  { value: "off", label: "Off", description: "No reasoning tokens" },
  { value: "low", label: "Low", description: "Light reasoning, low cost" },
  { value: "medium", label: "Medium", description: "Balanced" },
  { value: "high", label: "High", description: "Deep reasoning, higher cost + latency" },
];

export interface ReasoningSliderProps {
  value: ReasoningLevel;
  onChange: (level: ReasoningLevel) => void;
  disabled?: boolean;
  /**
   * The active model's reasoning policy. Without it every stop looks
   * available, which is how "Off" came to look like a control that did
   * nothing on models that cannot turn reasoning off.
   */
  policy?: ModelInfo["reasoningPolicy"];
}

export function ReasoningSlider({ value, onChange, disabled, policy }: ReasoningSliderProps) {
  const mandatory = reasoningIsMandatory(policy);
  const stops = reasoningStopsFor(policy);
  const stopFor = (level: ReasoningLevel): ReasoningStop =>
    stops.find((s) => s.level === level) ?? { level, effort: null };
  const labelFor = (level: ReasoningLevel) => LEVELS.find((l) => l.value === level)?.label ?? level;

  // Off is unavailable when the model cannot stop reasoning. Medium and High
  // are unavailable when they resolve to the same rung as a lower stop — two
  // buttons that do one thing would make the control look broken.
  const unavailable = (level: ReasoningLevel) =>
    level === "off" ? mandatory : stopFor(level).sameAs !== undefined;

  const titleFor = (level: (typeof LEVELS)[number]) => {
    const stop = stopFor(level.value);
    if (level.value === "off") {
      return mandatory ? "This model always reasons. It cannot be turned off" : level.description;
    }
    if (stop.sameAs) {
      return `Same as ${labelFor(stop.sameAs)} on this model, both ask for "${stop.effort}"`;
    }
    return stop.effort && stop.effort !== level.value
      ? `${level.description}, sent as "${stop.effort}"`
      : level.description;
  };

  // Spell the mapping out whenever any stop reaches the wire under a name
  // other than its own, or collapses onto a neighbour. Someone testing a new
  // model can then read exactly which rung each stop buys.
  const onStops = stops.filter((s) => s.level !== "off");
  const mappingDiffers = onStops.some((s) => s.effort !== s.level || s.sameAs !== undefined);
  const offEffort = stopFor("off").effort;

  return (
    <>
      <div className="reasoning-slider" role="radiogroup" aria-label="Reasoning level">
        {LEVELS.map((level) => {
          const off = unavailable(level.value);
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={value === level.value}
              title={titleFor(level)}
              // Still rendered, not hidden: a stop that vanishes per model
              // makes the control look broken. Disabled says why.
              disabled={disabled || off}
              className={`reasoning-slider__btn${value === level.value ? " is-active" : ""}`}
              onClick={() => onChange(level.value)}
            >
              {level.label}
            </button>
          );
        })}
      </div>
      {mandatory && !disabled && (
        <p className="settings-section__hint">
          This model always reasons. Its provider doesn&apos;t allow it to be turned off.{" "}
          <strong>Off</strong> asks for the least it will do
          {offEffort ? (
            <>
              {" "}
              (<code>{offEffort}</code>)
            </>
          ) : null}
          .
        </p>
      )}
      {mappingDiffers && !disabled && (
        <p className="settings-section__hint">
          On this model:{" "}
          {onStops.map((s, i) => (
            <span key={s.level}>
              {i > 0 && " · "}
              {labelFor(s.level)} = <code>{s.effort}</code>
            </span>
          ))}
        </p>
      )}
    </>
  );
}

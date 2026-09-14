import type { ModelInfo } from "../../../core/openrouter";
import type { ReasoningLevel } from "../../../core/storage";
import { displayName, labForModel, pickerEligibleModels } from "./model-grouping";
import {
  capabilityAtSetting,
  formatCapability,
  formatContext,
  formatPriceLong,
  formatRank,
  formatReleased,
  formatSpeed,
  rankModels,
  relativeCapability,
} from "./model-metrics";

export interface ModelDetailsCardProps {
  model: ModelInfo;
  /** The list the model was picked from — rank and bar are relative to it. */
  models: readonly ModelInfo[];
  /** The user's reasoning setting, to show the score that setting buys. */
  reasoning?: ReasoningLevel;
}

/**
 * What a `<select>` option cannot say about the chosen model: how capable it
 * is relative to the rest of the list, what it costs in words, how fast it
 * is, and what each capability means inside Excelente. Plain language on
 * purpose — the bracketed `[tools,reas,vis]` tags this replaces meant
 * nothing to the people the picker is for.
 */
export function ModelDetailsCard({ model, models, reasoning }: ModelDetailsCardProps) {
  // Ranks are relative to what the picker lists, so "#2 of 98" here is the
  // same "#2" the option text shows.
  const ranks = rankModels(pickerEligibleModels(models));
  const rank = ranks.byId.get(model.id);
  const relative = relativeCapability(models, model);
  const atSetting = reasoning ? capabilityAtSetting(model, reasoning) : null;
  const speed = formatSpeed(model.outputTokensPerSecond);
  const released = formatReleased(model.releasedAt ?? model.created);
  const alwaysReasons = model.reasoningPolicy?.mandatory === true;

  return (
    <div className="model-card">
      <div className="model-card__head">
        <span className="model-card__lab">{labForModel(model)}</span>
        <span className="model-card__name">{displayName(model)}</span>
      </div>

      <div className="model-card__score">
        <span className="model-card__score-label">Capability</span>
        {model.capability !== undefined ? (
          <>
            <strong className="model-card__score-value">
              {formatCapability(model.capability)}
            </strong>
            <span className="model-card__bar" aria-hidden="true">
              <span
                className="model-card__bar-fill"
                style={{ width: `${Math.round((relative ?? 0) * 100)}%` }}
              />
            </span>
            {rank?.capability !== undefined && (
              <span className="model-card__rank">
                {formatRank(rank.capability)} of {ranks.ofCapability} by capability
                {rank.value !== undefined && (
                  <>
                    {" · "}
                    {formatRank(rank.value)} of {ranks.ofValue} by value
                  </>
                )}
              </span>
            )}
          </>
        ) : (
          <span className="model-card__unranked">not yet benchmarked</span>
        )}
      </div>

      {atSetting && atSetting.score !== model.capability && (
        <p className="model-card__note">
          At your reasoning setting (<code>{atSetting.effort}</code>):{" "}
          <strong>{formatCapability(atSetting.score)}</strong>
        </p>
      )}

      <dl className="model-card__facts">
        <div>
          <dt>Price</dt>
          <dd>{formatPriceLong(model)}</dd>
        </div>
        {speed && (
          <div>
            <dt>Speed</dt>
            <dd>{speed}</dd>
          </div>
        )}
        {model.contextLength > 0 && (
          <div>
            <dt>Context</dt>
            <dd>{formatContext(model.contextLength)} tokens</dd>
          </div>
        )}
        {released && (
          <div>
            <dt>{model.releasedAt ? "Released" : "Listed"}</dt>
            <dd>{released}</dd>
          </div>
        )}
      </dl>

      <ul className="model-card__caps">
        <li className={model.supportsTools ? "is-yes" : "is-no"}>
          <span className="model-card__cap-name">Tools</span>
          {model.supportsTools
            ? "reads and writes your workbook"
            : "cannot use tools, so it cannot work in your workbook"}
        </li>
        <li className={model.supportsReasoning ? "is-yes" : "is-no"}>
          <span className="model-card__cap-name">Reasoning</span>
          {model.supportsReasoning
            ? alwaysReasons
              ? "thinks before answering — always on for this model"
              : "can think before answering; set the level under Reasoning"
            : "answers directly, with no thinking step"}
        </li>
        <li className={model.supportsVision ? "is-yes" : "is-no"}>
          <span className="model-card__cap-name">Vision</span>
          {model.supportsVision
            ? "reads the screenshots it takes to check its own work"
            : "cannot see screenshots; a separate vision model is used"}
        </li>
      </ul>
    </div>
  );
}

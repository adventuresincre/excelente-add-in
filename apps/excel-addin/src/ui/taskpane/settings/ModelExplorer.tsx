import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { isFreeTierModel, type ModelInfo } from "../../../core/openrouter";
import { displayName, labForModel, pickerEligibleModels } from "./model-grouping";
import {
  EXPLORER_SORTS,
  explorerRows,
  formatCapability,
  formatPricePair,
  formatRank,
  formatSpeed,
  rankModels,
  relativeCapability,
  type ExplorerFilters,
  type ExplorerSort,
} from "./model-metrics";

export interface ModelExplorerProps {
  /** "Compare models · Primary" — names the role the pick applies to. */
  title: string;
  models: readonly ModelInfo[];
  value: string | null;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  initialSort?: ExplorerSort;
  /**
   * True when the user has no OpenRouter key: every row is browsable and
   * choosable, but runs only once a key exists. Rows say so.
   */
  needsKey?: boolean;
  /**
   * Filters the role requires — the vision role can only take a model that
   * sees. Rendered checked and disabled so the constraint is visible rather
   * than silently applied.
   */
  lockedFilters?: Partial<ExplorerFilters>;
}

const NO_FILTERS: ExplorerFilters = { freeOnly: false, vision: false, reasoningOffable: false };

/**
 * One flat, sortable list of every model a role can use, across labs — the
 * comparison the per-lab `<select>` cannot make. A full-pane sheet rather
 * than a widened dropdown: the task pane is ~350px wide, and a row needs
 * name, score, price and speed to be worth reading.
 */
export function ModelExplorer({
  title,
  models,
  value,
  onSelect,
  onClose,
  initialSort = "capability",
  needsKey = false,
  lockedFilters,
}: ModelExplorerProps) {
  const [sort, setSort] = useState<ExplorerSort>(initialSort);
  const [filters, setFilters] = useState<ExplorerFilters>({ ...NO_FILTERS, ...lockedFilters });
  const closeRef = useRef<HTMLButtonElement>(null);

  // A dialog takes focus on open so Escape and the close button are reachable
  // without a mouse; the settings behind it are inert while it is up.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const rows = useMemo(() => explorerRows(models, filters, sort), [models, filters, sort]);
  // Same population as the dropdown, so "#2" means the same thing in both.
  const ranks = useMemo(() => rankModels(pickerEligibleModels(models)), [models]);
  const unscored = rows.filter((m) => m.capability === undefined).length;

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  const toggle = (key: keyof ExplorerFilters) => (e: ChangeEvent<HTMLInputElement>) =>
    setFilters((f) => ({ ...f, [key]: e.target.checked }));
  const locked = (key: keyof ExplorerFilters) => lockedFilters?.[key] !== undefined;

  return (
    <div
      className="model-explorer"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <header className="model-explorer__head">
        <h2 className="model-explorer__title">{title}</h2>
        <button
          ref={closeRef}
          type="button"
          className="model-explorer__close"
          onClick={onClose}
          aria-label="Close"
        >
          ✕
        </button>
      </header>

      <div className="model-explorer__controls">
        <label className="model-explorer__sort">
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value as ExplorerSort)}>
            {EXPLORER_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div className="model-explorer__filters" role="group" aria-label="Filters">
          <label>
            <input
              type="checkbox"
              checked={filters.freeOnly}
              onChange={toggle("freeOnly")}
              disabled={locked("freeOnly")}
            />
            Free only
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.vision}
              onChange={toggle("vision")}
              disabled={locked("vision")}
            />
            Can see screenshots
          </label>
          <label>
            <input
              type="checkbox"
              checked={filters.reasoningOffable}
              onChange={toggle("reasoningOffable")}
              disabled={locked("reasoningOffable")}
            />
            Reasoning can be turned off
          </label>
        </div>
      </div>

      <p className="model-explorer__legend">
        {needsKey && (
          <>
            Every model here needs an OpenRouter key. Pick one anyway; it waits for the key.{" "}
          </>
        )}
        #n is the model&apos;s rank among the models you can pick, from an independent benchmark
        (Artificial Analysis); the number after it is the score itself. Value ranks capability
        against price, paid models only. Prices are per 1M tokens, in/out.
        {unscored > 0 &&
          ` ${unscored} ${unscored === 1 ? "model is" : "models are"} not yet benchmarked.`}
      </p>

      <ul className="model-explorer__list">
        {rows.map((m) => {
          const selected = m.id === value;
          const relative = relativeCapability(models, m);
          const speed = formatSpeed(m.outputTokensPerSecond);
          const free = isFreeTierModel(m);
          const r = ranks.byId.get(m.id);
          const rankText =
            sort === "value"
              ? r?.value !== undefined
                ? `value ${formatRank(r.value)}`
                : null
              : r?.capability !== undefined
                ? formatRank(r.capability)
                : null;
          return (
            <li key={m.id}>
              <button
                type="button"
                className={`model-row${selected ? " is-selected" : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  onSelect(m.id);
                  onClose();
                }}
              >
                <span className="model-row__top">
                  <span className="model-row__name">{displayName(m)}</span>
                  <span className="model-row__lab">{labForModel(m)}</span>
                  {free && <span className="model-row__badge">Free</span>}
                  {needsKey && (
                    <span className="model-row__badge model-row__badge--key">
                      {selected ? "Chosen, waiting on key" : "Needs key"}
                    </span>
                  )}
                </span>
                <span className="model-row__meta">
                  <span className="model-row__score">
                    {rankText && <span className="model-row__rank">{rankText}</span>}
                    {m.capability !== undefined ? (
                      <>
                        {formatCapability(m.capability)}
                        <span className="model-row__bar" aria-hidden="true">
                          <span style={{ width: `${Math.round((relative ?? 0) * 100)}%` }} />
                        </span>
                      </>
                    ) : (
                      <span className="model-row__unranked">not benchmarked</span>
                    )}
                  </span>
                  <span className="model-row__price">
                    {free ? "free" : formatPricePair(m.pricing)}
                  </span>
                  {speed && <span className="model-row__speed">{speed}</span>}
                  <span className="model-row__caps">
                    {m.supportsVision && <span className="model-row__cap">Vision</span>}
                    {m.supportsReasoning && (
                      <span
                        className="model-row__cap"
                        title={
                          m.reasoningPolicy?.mandatory
                            ? "Reasoning is always on for this model"
                            : "Reasoning available"
                        }
                      >
                        Reasoning
                      </span>
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {rows.length === 0 && (
          <li className="model-explorer__empty">No models match these filters.</li>
        )}
      </ul>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { ModelPicker } from "./ModelPicker";
import { ModelDetailsCard } from "./ModelDetailsCard";
import { ModelExplorer } from "./ModelExplorer";
import {
  buildPicker,
  labelForPickerModel,
  pickerOptionModelId,
  pickerOptionValue,
  pickAutoVisionModel,
  primarySupportsVision,
} from "./model-grouping";
import type { ExplorerSort } from "./model-metrics";
import { useModels } from "./useModels";
import type { ReasoningLevel } from "../../../core/storage";
import type { ModelInfo } from "../../../core/openrouter";
import { DEFAULT_PUBLIC_CONFIG } from "../../../core/config";
import { edition, useHostedPickerRows } from "@edition";
import { hostedModelFor } from "../../../edition/hosted";
import { PendingModelNotice, focusApiKeyField, pendingModelName } from "../pending-model";

type Role = "primary" | "subagent" | "vision" | "summary";

/**
 * The model pickers, one per role.
 *
 * - **Primary** drives the main agent loop.
 * - **Subagent** powers spawn_subagent calls. Defaults to "same as primary"
 *   when left blank; a different model here is most useful for Reviewer
 *   subagents (cross-architecture verification surfaces blind spots).
 * - **Vision** routes screenshot tool results. When left as "auto", the
 *   harness keeps using primary inline if it's vision-capable and otherwise
 *   selects the configured `byokDefaults.visionModelId` (see
 *   pickAutoVisionModel for the fallback chain). Setting it explicitly
 *   keeps the primary's conversation text-only — better for caching and
 *   required when primary lacks vision.
 * - **Summary** folds long conversations; a cheap model is the point.
 *
 * Every picker is a native `<select>` (the accessibility pass depends on it)
 * showing `name · capability · price`; the chosen model gets a details card
 * beneath it, and "Compare all models" opens one flat, sortable list across
 * labs for that role. Capability scores arrive from the nightly catalog via
 * `useModels`; without them everything still renders, minus the numbers.
 */
export function ModelsSection({ sections = "all" }: { sections?: "primary" | "advanced" | "all" }) {
  const { apiKey, modelPref, setModelPref, openrouter, pendingModelId } = useApp();
  const { models, loading, error } = useModels(openrouter, apiKey);
  const [explorer, setExplorer] = useState<Role | null>(null);
  // The edition's own rows (a hosted tier), and the one that runs when a
  // keyless choice waits. Both empty/null in the community edition.
  const hostedRows = useHostedPickerRows();
  const hosted = edition.hostedModels;
  const fallback = edition.keylessFallback;

  const currentModelId = modelPref?.modelId ?? null;
  const currentReasoning: ReasoningLevel = modelPref?.reasoning ?? "off";
  const subagentOverride = modelPref?.subagentModelId ?? null;
  const visionOverride = modelPref?.visionModelId ?? null;
  const summaryOverride = modelPref?.summaryModelId ?? null;

  // Primary + subagent need tool support. Reasoning is not required because
  // it would exclude strong non-reasoning models like Qwen 3.7 Max.
  const toolModels = useMemo(() => models.filter((m) => m.supportsTools), [models]);

  // Vision picker shows models that support both tools and image input.
  // Tools is kept in the filter as a future-proofing measure: vision today
  // is a one-shot describer call where tools aren't strictly used, but
  // future multi-turn vision flows may rely on them.
  const visionModels = useMemo(
    () => models.filter((m) => m.supportsTools && m.supportsVision),
    [models]
  );

  // The dedicated-describer default — same resolver App.tsx feeds the
  // stream. Only reached when the primary cannot see images itself.
  const autoVisionModel = useMemo(() => pickAutoVisionModel(visionModels), [visionModels]);

  /**
   * Whether the primary can read an image itself, which decides what "leave
   * blank" means for the vision role: the primary inline, or a separate
   * describer call. Undefined while the list loads or for an id the list
   * doesn't carry — kept distinct from `false` so the UI doesn't claim a
   * model is blind on the strength of a list that hasn't arrived.
   */
  const primaryIsBlind = useMemo(
    () => primarySupportsVision(models, currentModelId, hostedRows) === false,
    [models, currentModelId, hostedRows]
  );

  const selectedPrimary = useMemo(
    () => toolModels.find((m) => m.id === currentModelId) ?? null,
    [toolModels, currentModelId]
  );
  const selectedSubagent = useMemo(
    () => toolModels.find((m) => m.id === subagentOverride) ?? null,
    [toolModels, subagentOverride]
  );
  const selectedVision = useMemo(
    () => visionModels.find((m) => m.id === visionOverride) ?? null,
    [visionModels, visionOverride]
  );
  const selectedSummary = useMemo(
    () => toolModels.find((m) => m.id === summaryOverride) ?? null,
    [toolModels, summaryOverride]
  );

  async function handlePrimaryChange(modelId: string) {
    if (!modelId) return;
    const target = hostedModelFor(hosted, modelId);
    if (target) {
      await setModelPref(target.modelPref());
      return;
    }
    // Leaving a hosted model drops its pinned role ids; any other switch
    // keeps the user's subagent/vision/summary picks exactly as they were.
    const leavingHosted = hostedModelFor(hosted, currentModelId) !== null;
    await setModelPref({
      modelId,
      reasoning: currentReasoning,
      subagentModelId: leavingHosted ? undefined : (subagentOverride ?? undefined),
      visionModelId: leavingHosted ? undefined : (visionOverride ?? undefined),
      summaryModelId: leavingHosted ? undefined : (summaryOverride ?? undefined),
      maxTurns: modelPref?.maxTurns ?? DEFAULT_PUBLIC_CONFIG.byokDefaults.maxTurns,
    });
  }

  async function handleSubagentChange(modelId: string) {
    if (!currentModelId) return;
    await setModelPref({
      modelId: currentModelId,
      reasoning: currentReasoning,
      subagentModelId: modelId || undefined,
      visionModelId: visionOverride ?? undefined,
      summaryModelId: summaryOverride ?? undefined,
      maxTurns: modelPref?.maxTurns,
    });
  }

  async function handleVisionChange(modelId: string) {
    if (!currentModelId) return;
    await setModelPref({
      modelId: currentModelId,
      reasoning: currentReasoning,
      subagentModelId: subagentOverride ?? undefined,
      visionModelId: modelId || undefined,
      summaryModelId: summaryOverride ?? undefined,
      maxTurns: modelPref?.maxTurns,
    });
  }

  async function handleSummaryChange(modelId: string) {
    if (!currentModelId) return;
    await setModelPref({
      modelId: currentModelId,
      reasoning: currentReasoning,
      subagentModelId: subagentOverride ?? undefined,
      visionModelId: visionOverride ?? undefined,
      summaryModelId: modelId || undefined,
      maxTurns: modelPref?.maxTurns,
    });
  }

  const hostedPrimary = hostedModelFor(hosted, currentModelId);
  const showPrimary = sections === "all" || sections === "primary";
  const showAdvanced = sections === "all" || sections === "advanced";
  // The list is public, so comparing is open to everyone; a keyless pick
  // waits for a key rather than being refused (pending-model).
  const canExplore = !loading && !error && models.length > 0;


  const explorerProps = (() => {
    switch (explorer) {
      case "primary":
        return {
          title: "Compare models · Primary",
          models: toolModels,
          value: currentModelId,
          onSelect: (id: string) => void handlePrimaryChange(id),
          initialSort: "capability" as ExplorerSort,
          needsKey: !apiKey,
        };
      case "subagent":
        return {
          title: "Compare models · Subagent",
          models: toolModels,
          value: subagentOverride,
          onSelect: (id: string) => void handleSubagentChange(id),
          initialSort: "capability" as ExplorerSort,
        };
      case "vision":
        return {
          title: "Compare models · Vision",
          models: visionModels,
          value: visionOverride,
          onSelect: (id: string) => void handleVisionChange(id),
          initialSort: "capability" as ExplorerSort,
          lockedFilters: { vision: true },
        };
      case "summary":
        return {
          title: "Compare models · Summary",
          models: toolModels,
          value: summaryOverride,
          onSelect: (id: string) => void handleSummaryChange(id),
          initialSort: "price" as ExplorerSort,
        };
      default:
        return null;
    }
  })();

  const compareButton = (role: Role) => (
    <button
      type="button"
      className="settings-linklike"
      onClick={() => setExplorer(role)}
      disabled={!canExplore || (role !== "primary" && !currentModelId)}
    >
      Compare all models
    </button>
  );

  return (
    <>
      {showPrimary && (
        <section className="settings-section">
          <h2 className="settings-section__title">Primary model</h2>
          {/* A hosted tier is described in exactly one place — the edition's
              own Settings section, which renders only when it applies — so
              this hint is about reading the list, nothing else. */}
          <p className="settings-section__hint">
            {!apiKey && (
              <>
                {hosted.length > 0
                  ? `Everything except ${hosted.map((h) => h.name).join(" and ")} needs an OpenRouter key; pick one anyway and it waits for the key.`
                  : "Every model needs an OpenRouter key; pick one anyway and it waits for the key."}{" "}
              </>
            )}
            The <strong>#number</strong> after a model is its <strong>capability rank</strong> among
            the models listed here, from independent benchmarks (Artificial Analysis): #1 is the
            most capable. The two Top 10 lists cover only models that can use tools, reason and see
            screenshots; Value ranks capability against price. Prices are per 1M tokens, in/out.
            Latest means released in the last 12 months.
          </p>
          <ModelPicker
            models={toolModels}
            ariaLabel="Primary model"
            value={currentModelId}
            onChange={handlePrimaryChange}
            loading={loading}
            error={error}
          />
          {selectedPrimary && (
            <ModelDetailsCard
              model={selectedPrimary}
              models={toolModels}
              reasoning={currentReasoning}
            />
          )}
          {pendingModelId && (
            <PendingModelNotice
              modelName={pendingModelName(toolModels, pendingModelId)}
              surface="settings"
              onAddKey={focusApiKeyField}
              fallbackName={fallback ? <fallback.LiveName /> : undefined}
              onUseFallback={fallback ? () => void handlePrimaryChange(fallback.id) : undefined}
            />
          )}
          {compareButton("primary")}
          {/* Only when the list actually says so — see `primaryIsBlind`. The
              agent screenshots the sheet to verify its own writes, so a blind
              primary is a real capability gap, not a footnote. */}
          {primaryIsBlind && (
            <p className="settings-section__alert" role="status">
              <strong>This model can&apos;t see your workbook.</strong>{" "}
              {autoVisionModel
                ? `Screenshots will be sent to ${shortName(autoVisionModel)} instead, billed separately on your key.`
                : "Screenshots will be sent to a separate vision model, billed separately on your key."}{" "}
              Review <strong>Vision model</strong> under Advanced.
            </p>
          )}
        </section>
      )}

      {/* Gated on the KEY, not on the primary model. Whether you can choose
          a model per role depends on whether you can pay for one; it has
          nothing to do with what the primary happens to be. With a hosted
          tier as primary and a key on file, an override here runs on YOUR
          key while the primary loop stays on the host's — see `roleOverride`
          and `OrchestratorDeps.roleClient`. With no key there is nothing to
          route to, and SettingsPanel hides Advanced entirely. */}
      {showAdvanced && (
        <>
          {hostedPrimary && (
            <section className="settings-section">
              <h2 className="settings-section__title">Role models</h2>
              <p className="settings-section__hint">
                Your primary is {hostedPrimary.name}, so every role runs on the model it is pinned
                to unless you override it below. An override runs on your own OpenRouter key and is
                billed to you.
              </p>
            </section>
          )}
          <section className="settings-section">
            <h2 className="settings-section__title">Subagent model</h2>
            <p className="settings-section__hint">
              Powers subagents (Explore, Audit, Builder, Reviewer). Leave blank to use the primary.
              A different model, especially for Reviewer, gives more independent verification.
            </p>
            <ModelPickerWithDefault
              models={toolModels}
              value={subagentOverride}
              ariaLabel="Sub-agent model"
              defaultLabel="Same as primary"
              onChange={handleSubagentChange}
              loading={loading}
              error={error}
              disabled={!apiKey || !currentModelId}
            />
            {selectedSubagent && (
              <ModelDetailsCard
                model={selectedSubagent}
                models={toolModels}
                reasoning={currentReasoning}
              />
            )}
            {compareButton("subagent")}
          </section>

          <section className="settings-section">
            <h2 className="settings-section__title">Vision model</h2>
            <p className="settings-section__hint">
              Receives images from screenshot tools and returns a text description so the
              primary&apos;s conversation stays text-only.{" "}
              {primaryIsBlind
                ? autoVisionModel
                  ? `Your primary can't read images, so leaving this blank routes them to ${shortName(autoVisionModel)}.`
                  : "Your primary can't read images, so leaving this blank routes them to the recommended vision model."
                : "Your primary can read images, so leaving this blank sends them straight to it, with no extra call, and it keeps the conversation context."}
            </p>
            <ModelPickerWithDefault
              models={visionModels}
              value={visionOverride}
              ariaLabel="Vision model"
              defaultLabel={
                primaryIsBlind
                  ? autoVisionModel
                    ? `Auto (${shortName(autoVisionModel)})`
                    : "Auto"
                  : "Same as primary"
              }
              onChange={handleVisionChange}
              loading={loading}
              error={error}
              disabled={!apiKey || !currentModelId}
            />
            {selectedVision && <ModelDetailsCard model={selectedVision} models={visionModels} />}
            {compareButton("vision")}
          </section>

          <section className="settings-section">
            <h2 className="settings-section__title">Summary model</h2>
            <p className="settings-section__hint">
              Used when the conversation grows past ~200k tokens. Folds older turns into a
              structured summary so the agent keeps focus. Runs once per long session. A cheaper
              model brings per-compaction cost down meaningfully since summarization doesn&apos;t
              need top-tier reasoning; the comparison opens sorted cheapest first. Leave blank to
              use the primary.
            </p>
            <ModelPickerWithDefault
              models={toolModels}
              value={summaryOverride}
              ariaLabel="Summary model"
              defaultLabel="Same as primary"
              onChange={handleSummaryChange}
              loading={loading}
              error={error}
              disabled={!apiKey || !currentModelId}
            />
            {selectedSummary && <ModelDetailsCard model={selectedSummary} models={toolModels} />}
            {compareButton("summary")}
          </section>
        </>
      )}

      {explorerProps && <ModelExplorer {...explorerProps} onClose={() => setExplorer(null)} />}
    </>
  );
}

/**
 * Wraps `ModelPicker` to render an empty/default option at the top. Used by
 * subagent + vision pickers so the user can clear an override back to "use
 * the default" without needing a separate Reset button.
 */
function ModelPickerWithDefault({
  models,
  value,
  defaultLabel,
  ariaLabel,
  onChange,
  loading,
  error,
  disabled,
}: {
  models: ModelInfo[];
  value: string | null;
  defaultLabel: string;
  /** Accessible name — the visible label is a separate section heading. */
  ariaLabel: string;
  onChange: (modelId: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
}) {
  if (loading) {
    return <div className="model-picker model-picker--loading">Loading models…</div>;
  }
  if (error) {
    return (
      <div className="model-picker model-picker--error" role="alert">
        Failed to load models: {error}
      </div>
    );
  }
  if (models.length === 0 && !disabled) {
    return (
      <div className="model-picker model-picker--empty">
        Enter your OpenRouter API key to load the model list.
      </div>
    );
  }

  // Role pickers never offer a hosted row: picking one here on a paid
  // primary would route the host's model through the user's own key under
  // the host's label.
  const { groups, ranks } = buildPicker(models);

  return (
    <select
      className="model-picker"
      aria-label={ariaLabel}
      value={value ?? ""}
      onChange={(e) => onChange(pickerOptionModelId(e.target.value))}
      disabled={disabled}
    >
      <option value="">{defaultLabel}</option>
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
  );
}

function shortName(m: ModelInfo): string {
  const parts = m.id.split("/");
  return parts[parts.length - 1] ?? m.name;
}

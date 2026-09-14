import { useEffect, useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { useModels } from "./useModels";
import { resolveOpenRouterModelId } from "../../../core/config";
import { ApiKeyField } from "./ApiKeyField";
import { ModelsSection } from "./ModelsSection";
import { ReasoningSlider } from "./ReasoningSlider";
import type { ReasoningLevel } from "../../../core/storage";
import { acreFreeLabel, isAcreFreeModel } from "../../../core/config";
import { useAcreFreeInfo } from "../useAcreFreeInfo";
import { APP_VERSION, BUILD_SHA, BUILD_ID, buildDate, checkForUpdate } from "../../../core/version";
import "./settings.css";

// Plain-language presets for the per-send turn cap. The user never sees
// the word "turns" — just how much work happens before Excelente checks
// in. Values map to the orchestrator's maxTurns.
// Doubled 2026-09-12 (was 25/50/100). Real CRE builds were reaching the
// ceiling mid-job, which surfaces as an unexplained stop rather than a
// deliberate check-in. A saved preference is NOT migrated: someone who had
// picked Longer (100) now reads as Balanced, with behaviour unchanged. That
// is deliberate — the old values collide with the new ones (50 was Balanced,
// it is now Shorter), so any automatic remap would eventually double a
// choice the user made on purpose.
const PACE_PRESETS: Array<{ value: number; label: string; hint: string }> = [
  { value: 50, label: "Shorter", hint: "Pauses to check in sooner" },
  { value: 100, label: "Balanced", hint: "Pauses after a moderate stretch" },
  { value: 200, label: "Longer", hint: "Recommended — does more before pausing" },
];
const DEFAULT_PACE = 200;

export function SettingsPanel() {
  const { apiKey, modelPref, setApiKey, clearApiKey, setModelPref, openrouter } = useApp();

  // Office caches the taskpane bundle hard, so "did my deploy land?" is not
  // answerable by eye. Compare this bundle's baked-in build id against the
  // one sitting next to it on the server. A failed check stays silent —
  // it must never be mistaken for an available update.
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof checkForUpdate>>>(null);
  useEffect(() => {
    const ac = new AbortController();
    void checkForUpdate(ac.signal).then((r) => {
      if (!ac.signal.aborted) setUpdate(r);
    });
    return () => ac.abort();
  }, []);

  const currentModelId = modelPref?.modelId ?? null;
  // The reasoning slider needs the ACTIVE model's policy to know whether
  // "Off" is even possible. The OpenRouter client caches its list for an
  // hour, so this rides on the fetch ModelsSection already triggered.
  const { models } = useModels(openrouter, apiKey);
  const reasoningPolicy = useMemo(() => {
    if (!currentModelId) return undefined;
    // A.CRE Free's sentinel is not a real OpenRouter id; resolve to the
    // model the proxy actually runs so its policy (mandatory) is honoured.
    const lookupId = resolveOpenRouterModelId(currentModelId);
    return models.find((m) => m.id === lookupId)?.reasoningPolicy;
  }, [models, currentModelId]);
  const currentReasoning: ReasoningLevel = modelPref?.reasoning ?? "off";
  const currentPace = modelPref?.maxTurns ?? DEFAULT_PACE;
  const acreFree = isAcreFreeModel(currentModelId);

  // Persist a model-pref change while preserving every other field — the
  // earlier version dropped summaryModelId / maxTurns whenever reasoning
  // changed, silently resetting those overrides.
  async function patchPref(patch: Partial<typeof modelPref> & object) {
    if (!currentModelId) return;
    await setModelPref({
      modelId: currentModelId,
      reasoning: currentReasoning,
      subagentModelId: modelPref?.subagentModelId,
      visionModelId: modelPref?.visionModelId,
      summaryModelId: modelPref?.summaryModelId,
      maxTurns: modelPref?.maxTurns,
      ...patch,
    });
  }

  return (
    <div className="settings-panel">
      <section className="settings-section">
        <h2 className="settings-section__title">OpenRouter API key</h2>
        <ApiKeyField
          storedKey={apiKey}
          onSave={setApiKey}
          onClear={clearApiKey}
          emptyHint={
            acreFree && !apiKey ? (
              <>
                Not a student / learner? Add an OpenRouter key and make Excelente far more capable
                than A.CRE Free. Get one at{" "}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                  openrouter.ai/keys
                </a>
                .
              </>
            ) : undefined
          }
        />
      </section>

      {/* Only speak about A.CRE Free when it is actually relevant: someone
          on their own key who has not chosen it does not need the pitch
          every time they open Settings. With no key it always applies —
          that is what they are running. */}
      {(!apiKey || acreFree) && <AcreFreeSection selected={acreFree} />}

      <ModelsSection sections="primary" />

      {/* No key means no choices to make here: A.CRE Free supplies every
          role, and the pinned model does not take a reasoning effort. An
          Advanced accordion that opens onto nothing actionable is worse
          than no accordion. */}
      {apiKey && (
        <details className="settings-advanced">
          <summary className="settings-advanced-toggle">Advanced</summary>

          {/* Explicit body element rather than styling <details> itself.
            Current Chromium wraps a <details>' non-summary children in a
            `::details-content` box, so `display:flex` + `gap` on the
            <details> spaced [summary, content] and NOT the sections inside
            it — which is why every Advanced heading sat flush against the
            control above it. */}
          <div className="settings-advanced__body">
            <ModelsSection sections="advanced" />

            <section className="settings-section">
              <h2 className="settings-section__title">Reasoning</h2>
              <ReasoningSlider
                value={currentReasoning}
                onChange={(level) => void patchPref({ reasoning: level })}
                disabled={!currentModelId}
                policy={reasoningPolicy}
              />
              {!currentModelId && <p className="settings-section__hint">Pick a model first.</p>}
            </section>

            <section className="settings-section">
              <h2 className="settings-section__title">How long the agent works</h2>
              <p className="settings-section__hint">
                Excelente pauses to check in with you after a stretch of work. Pick how much it does
                before pausing — you can always click “Continue Working” to keep it going.
              </p>
              <div className="pace-options" role="group" aria-label="Agent pace">
                {PACE_PRESETS.map((preset) => (
                  <button
                    key={preset.value}
                    type="button"
                    className={`pace-option${currentPace === preset.value ? " is-active" : ""}`}
                    onClick={() => void patchPref({ maxTurns: preset.value })}
                    disabled={!currentModelId}
                    title={preset.hint}
                  >
                    <span className="pace-option__label">{preset.label}</span>
                    <span className="pace-option__hint">{preset.hint}</span>
                  </button>
                ))}
              </div>
              {!currentModelId && <p className="settings-section__hint">Pick a model first.</p>}
            </section>
          </div>
        </details>
      )}

      <section className="settings-section settings-section--about">
        <h2 className="settings-section__title">About</h2>
        <p className="settings-about">
          <span className="settings-about__brand">Excelente</span>{" "}
          <span className="settings-about__tag">alpha</span>{" "}
          {update?.deployed.env === "dev" && (
            <span className="settings-about__env" title="Development instance — not production">
              DEV
            </span>
          )}{" "}
          <span className="settings-about__version" title={`Build ${BUILD_ID} · ${buildDate()}`}>
            v{APP_VERSION} · {BUILD_SHA}
          </span>
          <br />
          Open source · made by{" "}
          <a
            href="https://www.aiedge.ac"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-about__link"
          >
            AI.Edge
          </a>{" "}
          by{" "}
          <a
            href="https://www.adventuresincre.com"
            target="_blank"
            rel="noopener noreferrer"
            className="settings-about__link"
          >
            A.CRE
          </a>
          .
        </p>
        {update?.stale && (
          <p className="settings-about__update" role="status">
            A newer build (<code>{update.deployed.buildId}</code>) is deployed. Close and reopen the
            task pane to load it.
          </p>
        )}
        <p className="settings-about__copy">
          Copyright © 2025–2026 CRE Edge, LLC. Licensed under Apache 2.0. The name, logo, and
          bundled Skills are licensed separately.
        </p>
      </section>
    </div>
  );
}

/**
 * The A.CRE Free explainer. Its own component so the /health lookup that
 * names the live model only runs when Settings is actually open, and so the
 * label falls back to the bare tier name on first paint.
 *
 * The wording splits on `selected` because the un-split version asserted
 * "You're using A.CRE Free" to every BYOK reader of this panel too.
 */
function AcreFreeSection({ selected }: { selected: boolean }) {
  const { modelLabel } = useAcreFreeInfo();
  const label = acreFreeLabel(modelLabel);
  return (
    <section className="settings-section">
      <h2 className="settings-section__title">A.CRE Free</h2>
      <p className="settings-section__hint">
        {selected ? (
          <>
            You&apos;re using <strong>{label}</strong> as your model.
          </>
        ) : (
          <>
            <strong>{label}</strong> needs no key and no sign-in — pick it as your model below.
          </>
        )}{" "}
        A.CRE covers the cost to make it accessible to students / learners. Includes certain limits
        to reduce abuse; every role (primary, sub-agents, Reviewer, vision) runs on the same
        A.CRE-selected model.
      </p>
    </section>
  );
}

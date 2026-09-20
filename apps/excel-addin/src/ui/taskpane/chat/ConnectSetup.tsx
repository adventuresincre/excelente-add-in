import { useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { ApiKeyField } from "../settings/ApiKeyField";
import { ModelPicker } from "../settings/ModelPicker";
import { useModels } from "../settings/useModels";
import { DEFAULT_PUBLIC_CONFIG, resolveByokDefaults } from "../../../core/config";
import { edition, useEntitledHostedIds } from "@edition";
import { hostedModelFor } from "../../../edition/hosted";
import type { HostedModel } from "../../../edition/types";
import { OnboardConnectors } from "./OnboardConnectors";

/**
 * Wizard steps.
 *
 *   intro       the edition's own opening screens (`edition.setup.Intro`),
 *               when it has any: a choice of path, a sign-in, a question.
 *               The community edition has none and opens on `connect`.
 *   connect     "Connect your model." A list of providers with the key
 *               field inline. Today that list is OpenRouter alone; it is a
 *               list so a second provider slots in beside it.
 *   model       pick the primary model.
 *   connectors  the shared connectors step. Skipped when the intro already
 *               signed the user in to their memberships.
 */
type Step = "intro" | "connect" | "model" | "connectors";

/**
 * Chat-first first-run. Stays on Chat (no bounce to Settings). Model
 * preference is written only at the end so no step is skipped the moment a
 * model is chosen.
 */
export function ConnectSetup() {
  const { apiKey, setApiKey, clearApiKey, setModelPref, openrouter } = useApp();
  const Intro = edition.setup.Intro;
  const entitled = useEntitledHostedIds();
  const opening: Step = Intro ? "intro" : "connect";
  const [step, setStep] = useState<Step>(apiKey ? "model" : opening);
  const [picked, setPicked] = useState("");
  const [lockedNote, setLockedNote] = useState<string | null>(null);
  // Set when the intro signed the user in to a membership and chose a hosted
  // model: the connectors step is then redundant, and the hosted row is
  // preselected so a key-adder can simply Continue.
  const [memberPath, setMemberPath] = useState(false);
  const { models, loading, error } = useModels(openrouter, apiKey);
  const toolModels = useMemo(() => models.filter((m) => m.supportsTools), [models]);

  const pickedHosted = hostedModelFor(edition.hostedModels, picked);
  const pickedModel = toolModels.find((m) => m.id === picked);
  // Any text-only primary, not just a free one: the gap is the same whoever
  // is paying. Gated on having FOUND the model, so a list that hasn't loaded
  // never produces the warning.
  const showVisionNote =
    Boolean(picked) && !pickedHosted && pickedModel ? !pickedModel.supportsVision : false;

  async function handleSaveKey(key: string) {
    await setApiKey(key);
    setStep("model");
  }

  async function finish(modelId: string) {
    if (!modelId) return;
    const hosted = hostedModelFor(edition.hostedModels, modelId);
    if (hosted) {
      await setModelPref(hosted.modelPref());
      return;
    }
    // Start from the bundled defaults so the cheap summary model for
    // compaction and the vision fallback are set — then honour the pick.
    await setModelPref({
      ...resolveByokDefaults(DEFAULT_PUBLIC_CONFIG.byokDefaults, models),
      modelId,
    });
  }

  function onOwnModel() {
    setStep("connect");
  }

  function onHosted(model: HostedModel, alsoOwnKey: boolean) {
    if (!alsoOwnKey) {
      void finish(model.id);
      return;
    }
    setMemberPath(true);
    setPicked(model.id);
    setStep("connect");
  }

  function pick(modelId: string) {
    const hosted = hostedModelFor(edition.hostedModels, modelId);
    if (hosted && !entitled.has(hosted.id)) {
      // A locked row: say why rather than silently ignoring the click.
      setLockedNote(
        hosted.lockedHint ??
          `${hosted.name} is not available to you yet. Choose another model for now.`
      );
      return;
    }
    setLockedNote(null);
    setPicked(modelId);
  }

  function afterModel() {
    if (memberPath) void finish(picked);
    else setStep("connectors");
  }

  const openRouterSteps = (
    <ol className="connect-setup__steps">
      <li>
        Open{" "}
        <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
          openrouter.ai/keys
        </a>{" "}
        and create an account.
      </li>
      <li>Click Create Key, then copy it.</li>
      <li>Paste it below.</li>
    </ol>
  );

  return (
    <div className="chat-panel__empty">
      <BrandMark />
      {step === "intro" && Intro && <Intro onOwnModel={onOwnModel} onHosted={onHosted} />}

      {step === "connect" && (
        <>
          <h2>
            Connect your <em className="accent">model</em>.
          </h2>
          <p>{edition.setup.intro}</p>
          <div className="connect-setup__form">
            <ul className="connect-setup__providers" aria-label="Model providers">
              <li className="connect-setup__provider">
                <div className="connect-setup__provider-head">
                  <span className="connect-setup__provider-name">OpenRouter</span>
                  <span className="connect-setup__provider-blurb">
                    One key reaches Claude, GPT, Gemini, Grok, and hundreds more. You pay OpenRouter
                    for what you use; Excelente takes nothing.
                  </span>
                </div>
                {openRouterSteps}
                <ApiKeyField storedKey={apiKey} onSave={handleSaveKey} onClear={clearApiKey} />
              </li>
            </ul>
            {Intro && (
              <div className="connect-setup__actions">
                <button type="button" className="btn-secondary" onClick={() => setStep("intro")}>
                  Back
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {step === "model" && (
        <>
          <h2>
            Pick your <em className="accent">model</em>.
          </h2>
          {/* This step is only reached after a key is saved, so the reader is
              a BYOK user. Nothing about a hosted tier belongs here — the
              picker labels its own sections, and the hint below fires only
              if they actually pick one. */}
          <p>
            Free models may train on your data. Latest means released in the last 12 months; each
            lab&apos;s models are listed most capable first, with a capability score after the name.
          </p>
          <div className="connect-setup__form">
            <ModelPicker
              models={toolModels}
              ariaLabel="Primary model"
              value={picked || null}
              onChange={pick}
              loading={loading}
              error={error}
            />
            {lockedNote && <p className="settings-section__hint">{lockedNote}</p>}
            {pickedHosted?.setupPickHint && (
              <p className="settings-section__hint">{pickedHosted.setupPickHint}</p>
            )}
            {showVisionNote && (
              <div className="ask-user-card">
                <strong>This model can&apos;t see your workbook.</strong> Excelente will send
                screenshots to a separate vision model, which OpenRouter bills separately. You can
                change that later in Settings under Advanced.
              </div>
            )}
            <div className="connect-setup__actions">
              {/* A mistyped key used to strand people here: the list fails to
                  load, nothing is pickable, and there was no way back. */}
              <button type="button" className="btn-secondary" onClick={() => setStep("connect")}>
                Change key
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!picked || loading}
                onClick={afterModel}
              >
                Continue
              </button>
            </div>
          </div>
        </>
      )}

      {step === "connectors" && (
        <>
          <h2>
            Connect your <em className="accent">A.CRE tools</em>.
          </h2>
          <p>
            If you already use CRE Agents or the A.CRE Intelligence Hub, turn them on here. Or add
            them later in Capabilities.
          </p>
          <OnboardConnectors onContinue={() => void finish(picked)} />
        </>
      )}
    </div>
  );
}

function BrandMark() {
  return (
    <img
      src="/assets/logo-filled.png"
      alt="Excelente"
      className="chat-panel__brand-mark"
      width={72}
      height={72}
    />
  );
}

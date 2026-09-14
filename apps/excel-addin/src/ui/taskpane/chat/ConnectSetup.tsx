import { useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { ApiKeyField } from "../settings/ApiKeyField";
import { ModelPicker } from "../settings/ModelPicker";
import { useModels } from "../settings/useModels";
import {
  ACRE_FREE_DISPLAY_NAME,
  ACRE_FREE_SENTINEL_ID,
  acreFreeModelPref,
  DEFAULT_PUBLIC_CONFIG,
  isAcreFreeModel,
  resolveByokDefaults,
} from "../../../core/config";
import { OnboardConnectors } from "./OnboardConnectors";

type Step = "start" | "key" | "model" | "connectors";

/**
 * Chat-first first-run. Stays on Chat (no bounce to Settings). OpenRouter
 * is the encouraged path; A.CRE Free is available with no key and no
 * sign-in. Model preference is written only after the connector step so
 * that step is not skipped the moment a model is chosen.
 */
export function ConnectSetup() {
  const { apiKey, setApiKey, clearApiKey, setModelPref, openrouter } = useApp();
  const [step, setStep] = useState<Step>(apiKey ? "model" : "start");
  const [acreDisclosure, setAcreDisclosure] = useState(false);
  const [picked, setPicked] = useState("");
  const { models, loading, error } = useModels(openrouter, apiKey);
  const toolModels = useMemo(() => models.filter((m) => m.supportsTools), [models]);

  const pickedModel = toolModels.find((m) => m.id === picked);
  // Any text-only primary, not just a free one: the gap is the same whoever
  // is paying. Gated on having FOUND the model, so a list that hasn't loaded
  // never produces the warning.
  const showVisionNote =
    Boolean(picked) && !isAcreFreeModel(picked) && pickedModel
      ? !pickedModel.supportsVision
      : false;

  async function handleSaveKey(key: string) {
    await setApiKey(key);
    setStep("model");
  }

  async function finish(modelId: string) {
    if (isAcreFreeModel(modelId)) {
      await setModelPref(acreFreeModelPref(DEFAULT_PUBLIC_CONFIG.byokDefaults));
      return;
    }
    // Start from the bundled defaults so the cheap summary model for
    // compaction and the vision fallback are set — then honour the pick.
    await setModelPref({
      ...resolveByokDefaults(DEFAULT_PUBLIC_CONFIG.byokDefaults, models),
      modelId,
    });
  }

  function chooseAcreFree() {
    setPicked(ACRE_FREE_SENTINEL_ID);
    setStep("connectors");
  }

  return (
    <div className="chat-panel__empty">
      <BrandMark />
      {step === "start" && (
        <>
          <h2>
            Get started with <em className="accent">Excelente</em>.
          </h2>
          <p>
            Excelente can use any model on OpenRouter with your own key, or start with a basic model
            that A.CRE pays for (for a limited time).
          </p>
          <div className="connect-setup__form">
            <p className="settings-section__hint">
              Connect your own OpenRouter key to pick hundreds of models (from free to frontier).
            </p>
            <button
              type="button"
              className="continue-working__btn connect-setup__primary"
              onClick={() => setStep("key")}
            >
              Use an OpenRouter key
            </button>
            <div className="connect-setup__or">or</div>
            <button
              type="button"
              className="btn-secondary connect-setup__primary"
              onClick={() => setAcreDisclosure(true)}
            >
              Use {ACRE_FREE_DISPLAY_NAME} — no key, no sign-in (for a limited time)
            </button>
            {acreDisclosure && <AcreFreeDisclosure onContinue={chooseAcreFree} />}
          </div>
        </>
      )}

      {step === "key" && (
        <>
          <h2>
            Add your <em className="accent">OpenRouter key</em>.
          </h2>
          <p>
            Excelente uses OpenRouter to talk to ChatGPT, Claude, Gemini, and others. You pay
            OpenRouter for what you use.
          </p>
          <div className="connect-setup__form">
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
            <ApiKeyField storedKey={apiKey} onSave={handleSaveKey} onClear={clearApiKey} />
            <div className="connect-setup__actions">
              <button type="button" className="btn-secondary" onClick={() => setStep("start")}>
                Back
              </button>
            </div>
          </div>
        </>
      )}

      {step === "model" && (
        <>
          <h2>
            Pick your <em className="accent">model</em>.
          </h2>
          {/* This step is only reached after a key is saved, so the reader is
              a BYOK user. Nothing about A.CRE Free belongs here — the picker
              labels its own sections, and the note below fires only if they
              actually pick it. */}
          <p>
            Free models may train on your data. Latest means released in the last 12 months; each
            lab&apos;s models are listed most capable first, with a capability score after the name.
          </p>
          <div className="connect-setup__form">
            <ModelPicker
              models={toolModels}
              ariaLabel="Primary model"
              value={picked || null}
              onChange={setPicked}
              loading={loading}
              error={error}
            />
            {isAcreFreeModel(picked) && (
              <p className="settings-section__hint">
                A.CRE covers this model. Your data is not used for training. It is far less capable
                than OpenRouter models — you can add a key in Settings anytime.
              </p>
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
              <button type="button" className="btn-secondary" onClick={() => setStep("key")}>
                Change key
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!picked || loading}
                onClick={() => setStep("connectors")}
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
          <OnboardConnectors onContinue={() => void finish(picked || ACRE_FREE_SENTINEL_ID)} />
        </>
      )}
    </div>
  );
}

/**
 * The one thing a free user must read before starting, shown inline where
 * they make the choice — not as a separate gate that can lock the composer.
 */
function AcreFreeDisclosure({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="ask-user-card connect-setup__warn">
      <div className="ask-user-card__header">{ACRE_FREE_DISPLAY_NAME} is a starting point</div>
      <p>
        {ACRE_FREE_DISPLAY_NAME} is built for students and learners on a budget, or anyone who wants
        to quickly experience what an AI harness inside Excel can do.
      </p>
      <p>
        It uses a capable, lower-cost model with limited shared usage, and it is offered for a
        limited time — A.CRE may change or end it at any point. As soon as you&apos;re ready, we
        recommend adding your own OpenRouter key. That gives you control over which model you use,
        the quality of the model, and your usage.
      </p>
      <p>
        Your workbook is sent to the model to complete the work and is not used to train the model.
      </p>
      <div className="connect-setup__actions connect-setup__actions--center">
        <button type="button" className="btn-primary" onClick={onContinue}>
          Continue with {ACRE_FREE_DISPLAY_NAME}
        </button>
      </div>
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

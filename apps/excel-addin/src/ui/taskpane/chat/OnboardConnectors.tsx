import { useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import {
  isValidMcpServerUrl,
} from "../../../core/storage";
import {
  ACRE_MCP_PRESETS,
  isOfficeDialogAvailable,
  oauthRedirectUri,
  openAuthWindowViaOfficeDialog,
  runMcpOAuthFlow,
} from "../../../core/mcp";
import type { McpPreset } from "../../../core/mcp";
import { shouldActivateAfterAdd } from "../settings/activate-connector";

/**
 * First-run connector toggles (CRE Agents + Intelligence Hub). Skip is
 * allowed — the same presets live under Plan after setup.
 */
export function OnboardConnectors({ onContinue }: { onContinue: () => void }) {
  const { mcp, enableConnector } = useApp();
  const [statuses, setStatuses] = useState(() => mcp.getStatuses());
  const [vicOn, setVicOn] = useState(false);
  const [hubOn, setHubOn] = useState(false);
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const [presetErrors, setPresetErrors] = useState<Record<string, string>>({});
  const [personalUrl, setPersonalUrl] = useState("");

  useEffect(() => mcp.subscribe(setStatuses), [mcp]);

  const vic = ACRE_MCP_PRESETS.find((p) => p.id === "cre-agents");
  const hub = ACRE_MCP_PRESETS.find((p) => p.id === "acre-intelligence-hub");

  async function addServerAndActivate(
    args: Parameters<typeof mcp.addServer>[0]
  ): Promise<void> {
    await mcp.addServer(args);
    const row = mcp.getStatuses().find((s) => s.config.name === args.name);
    if (shouldActivateAfterAdd(row?.state)) {
      enableConnector(args.name);
    }
  }

  function setPresetError(presetId: string, message: string | null) {
    setPresetErrors((prev) => ({ ...prev, [presetId]: message ?? "" }));
  }

  async function connectOAuthPreset(preset: McpPreset, mcpUrl: string) {
    if (!isOfficeDialogAvailable()) {
      setPresetError(
        preset.id,
        "Sign-in windows aren't available in this host. Open Excelente inside Excel and try again."
      );
      return;
    }
    setBusyPresetId(preset.id);
    setPresetError(preset.id, null);
    try {
      const tokens = await runMcpOAuthFlow({
        mcpUrl,
        redirectUri: oauthRedirectUri(),
        openAuthWindow: openAuthWindowViaOfficeDialog,
      });
      await addServerAndActivate({
        name: preset.name,
        url: mcpUrl,
        ...(tokens ? { auth: "oauth" as const, oauth: tokens } : {}),
        presetId: preset.id,
      });
    } catch (e) {
      setPresetError(preset.id, (e as Error).message);
    } finally {
      setBusyPresetId(null);
    }
  }

  async function connectPersonalUrlPreset(preset: McpPreset, url: string) {
    setBusyPresetId(preset.id);
    setPresetError(preset.id, null);
    try {
      await addServerAndActivate({ name: preset.name, url, presetId: preset.id });
      setPersonalUrl("");
    } catch (e) {
      setPresetError(preset.id, (e as Error).message);
    } finally {
      setBusyPresetId(null);
    }
  }

  function isAdded(preset: McpPreset): boolean {
    return statuses.some(
      (s) => s.config.presetId === preset.id || s.config.name === preset.name
    );
  }

  return (
    <div className="connect-setup__form">
      <div className="mcp-presets">
        {vic && (
          <div className="mcp-preset-row">
            <div className="mcp-preset-row__top">
              <label className="connect-setup__check">
                <input
                  type="checkbox"
                  checked={vicOn || isAdded(vic)}
                  onChange={(e) => setVicOn(e.target.checked)}
                />
                <img className="connect-setup__brand" src={vic.icon.small} alt="" width={18} height={18} />
                <div className="mcp-preset-row__main">
                  <div className="mcp-preset-row__label">I&apos;m a CRE Agents client</div>
                  <div className="mcp-preset-row__desc">Vic — CRE methods and ready-to-run tasks.</div>
                </div>
              </label>
            </div>
            {(vicOn || isAdded(vic)) && (
              <div className="mcp-preset-row__url-form">
                {presetErrors[vic.id] ? (
                  <span className="mcp-preset-row__error" role="alert">{presetErrors[vic.id]}</span>
                ) : null}
                <button
                  type="button"
                  className="mcp-preset-row__connect"
                  disabled={isAdded(vic) || busyPresetId === vic.id}
                  onClick={() => {
                    if (vic.connect.kind === "oauth") {
                      void connectOAuthPreset(vic, vic.connect.url);
                    }
                  }}
                >
                  {isAdded(vic) ? "Signed in ✓" : busyPresetId === vic.id ? "Connecting…" : "Sign in"}
                </button>
              </div>
            )}
          </div>
        )}
        {hub && (
          <div className="mcp-preset-row">
            <div className="mcp-preset-row__top">
              <label className="connect-setup__check">
                <input
                  type="checkbox"
                  checked={hubOn || isAdded(hub)}
                  onChange={(e) => setHubOn(e.target.checked)}
                />
                <img className="connect-setup__brand" src={hub.icon.small} alt="" width={18} height={18} />
                <div className="mcp-preset-row__main">
                  <div className="mcp-preset-row__label">I use the A.CRE Intelligence Hub</div>
                  <div className="mcp-preset-row__desc">Primary-source CRE data — rates, employment, risk.</div>
                </div>
              </label>
            </div>
            {(hubOn || isAdded(hub)) && hub.connect.kind === "personal-url" && (
              <form
                className="mcp-preset-row__url-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (isValidMcpServerUrl(personalUrl) && busyPresetId !== hub.id) {
                    void connectPersonalUrlPreset(hub, personalUrl.trim());
                  }
                }}
              >
                {presetErrors[hub.id] ? (
                  <span className="mcp-preset-row__error" role="alert">{presetErrors[hub.id]}</span>
                ) : null}
                {isAdded(hub) ? (
                  <button type="button" className="mcp-preset-row__connect" disabled>
                    Added ✓
                  </button>
                ) : (
                  <>
                    <p className="mcp-preset-row__help">
                      {hub.connect.help} Find yours in{" "}
                      {hub.connect.links.map((link, i) => (
                        <span key={link.url}>
                          {i > 0 && " or "}
                          <a
                            href={link.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mcp-preset-row__link"
                          >
                            {link.label}
                          </a>
                        </span>
                      ))}
                      .
                    </p>
                    <div className="mcp-preset-row__url-controls">
                      <input
                        type="text"
                        className="mcp-add-form__input"
                        value={personalUrl}
                        onChange={(e) => setPersonalUrl(e.target.value)}
                        placeholder="https://…/mcp/…"
                        disabled={busyPresetId === hub.id}
                        spellCheck={false}
                        aria-label={`Personal MCP URL for ${hub.label}`}
                      />
                      <button
                        type="submit"
                        className="mcp-preset-row__connect"
                        disabled={!isValidMcpServerUrl(personalUrl) || busyPresetId === hub.id}
                      >
                        {busyPresetId === hub.id ? "Connecting…" : "Add"}
                      </button>
                    </div>
                  </>
                )}
              </form>
            )}
          </div>
        )}
      </div>
      <div className="connect-setup__actions">
        <button type="button" className="btn-primary" onClick={onContinue}>
          Continue
        </button>
      </div>
    </div>
  );
}

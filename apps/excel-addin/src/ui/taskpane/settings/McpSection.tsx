import { useEffect, useMemo, useState } from "react";
import { useApp } from "../AppProvider";
import { ConfirmButton } from "../ConfirmButton";
import { isValidMcpServerName, isValidMcpServerUrl } from "../../../core/storage";
import {
  ACRE_MCP_PRESETS,
  isOfficeDialogAvailable,
  oauthRedirectUri,
  openAuthWindowViaOfficeDialog,
  runMcpOAuthFlow,
} from "../../../core/mcp";
import type { McpPreset, McpServerStatus } from "../../../core/mcp";
import { shouldActivateAfterAdd } from "./activate-connector";

/**
 * Settings section for managing MCP server connections. A.CRE presets
 * connect with one click — CRE Agents opens its own sign-in page (email +
 * emailed code) in an Office dialog; the Intelligence Hub takes the
 * member's personal MCP URL and connects automatically. Any other server
 * is added by entering a short name + JSON-RPC URL. The list below shows
 * every connected server with its status (connecting / connected / error)
 * and a remove button. Configs persist in IndexedDB and reconnect on app
 * startup. A successful Connect also turns the server on in the chat
 * toolbelt so its tools reach the next turn without a second toggle.
 */
export function McpSection() {
  const { mcp, activeConnectorNames, enableConnector, disableConnector } = useApp();
  const [statuses, setStatuses] = useState<McpServerStatus[]>(() => mcp.getStatuses());
  const [busyPresetId, setBusyPresetId] = useState<string | null>(null);
  const [presetErrors, setPresetErrors] = useState<Record<string, string>>({});
  // Preset whose personal-URL input is expanded.
  const [urlPromptPresetId, setUrlPromptPresetId] = useState<string | null>(null);
  const [personalUrl, setPersonalUrl] = useState("");

  useEffect(() => mcp.subscribe(setStatuses), [mcp]);

  /**
   * Persist + handshake, then load the server into the chat toolbelt on
   * success. Connect without this second step used to leave CRE Agents
   * (and every other MCP server) registered but invisible to the agent
   * until the user found the composer "+" toggle.
   */
  async function addServerAndActivate(args: Parameters<typeof mcp.addServer>[0]): Promise<void> {
    await mcp.addServer(args);
    const row = mcp.getStatuses().find((s) => s.config.name === args.name);
    if (shouldActivateAfterAdd(row?.state)) {
      enableConnector(args.name);
    }
  }

  function setPresetError(presetId: string, message: string | null) {
    setPresetErrors((prev) => ({ ...prev, [presetId]: message ?? "" }));
  }

  /** CRE Agents path: the server's own hosted sign-in via MCP OAuth. */
  async function connectOAuthPreset(preset: McpPreset, mcpUrl: string) {
    // Check the sign-in window can open BEFORE the flow does network work:
    // discovery + dynamic client registration create state on the remote
    // auth server, and each doomed attempt would orphan a registration.
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

  /** Intelligence Hub path: the member's personal, self-authenticating URL. */
  async function connectPersonalUrlPreset(preset: McpPreset, url: string) {
    setBusyPresetId(preset.id);
    setPresetError(preset.id, null);
    try {
      await addServerAndActivate({ name: preset.name, url, presetId: preset.id });
      setUrlPromptPresetId(null);
      setPersonalUrl("");
    } catch (e) {
      setPresetError(preset.id, (e as Error).message);
    } finally {
      setBusyPresetId(null);
    }
  }

  function handlePresetClick(preset: McpPreset) {
    if (preset.connect.kind === "oauth") {
      void connectOAuthPreset(preset, preset.connect.url);
    } else {
      setPresetError(preset.id, null);
      setUrlPromptPresetId((prev) => (prev === preset.id ? null : preset.id));
    }
  }

  return (
    <section className="settings-section">
      <h2 className="settings-section__title">Connectors (MCP)</h2>

      <div className="mcp-presets">
        <p className="settings-section__hint">One-click real estate connectors.</p>
        {ACRE_MCP_PRESETS.map((preset) => {
          const added = statuses.some(
            (s) => s.config.presetId === preset.id || s.config.name === preset.name
          );
          const busy = busyPresetId === preset.id;
          const error = presetErrors[preset.id];
          const showUrlPrompt =
            preset.connect.kind === "personal-url" && urlPromptPresetId === preset.id && !added;
          const urlValid = isValidMcpServerUrl(personalUrl);
          return (
            <div key={preset.id} className="mcp-preset-row">
              <div className="mcp-preset-row__top">
                <div className="mcp-preset-row__main">
                  <div className="mcp-preset-row__label">{preset.label}</div>
                  <div className="mcp-preset-row__desc">{preset.description}</div>
                  {error ? (
                    <span className="mcp-preset-row__error" role="alert">
                      {error}
                    </span>
                  ) : null}
                </div>
                <button
                  type="button"
                  className="mcp-preset-row__connect"
                  disabled={added || busy}
                  onClick={() => handlePresetClick(preset)}
                >
                  {added ? "Added ✓" : busy ? "Connecting…" : "Connect"}
                </button>
              </div>
              {showUrlPrompt && preset.connect.kind === "personal-url" && (
                <form
                  className="mcp-preset-row__url-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (urlValid && !busy) {
                      void connectPersonalUrlPreset(preset, personalUrl.trim());
                    }
                  }}
                >
                  <p className="mcp-preset-row__help">
                    {preset.connect.help} Find yours in{" "}
                    {preset.connect.links.map((link, i) => (
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
                      disabled={busy}
                      spellCheck={false}
                      aria-label={`Personal MCP URL for ${preset.label}`}
                    />
                    <button
                      type="submit"
                      className="mcp-preset-row__connect"
                      disabled={!urlValid || busy}
                    >
                      {busy ? "Connecting…" : "Add"}
                    </button>
                  </div>
                </form>
              )}
            </div>
          );
        })}
      </div>

      <p className="settings-section__hint">
        Or connect any external connector (MCP). Each added connector appears in the agent's
        toolbelt.
      </p>

      <McpAddForm
        onAdd={async ({ name, url }) => {
          await addServerAndActivate({ name, url });
        }}
        existingNames={statuses.map((s) => s.config.name)}
      />

      {statuses.length > 0 && (
        <>
          <p className="settings-section__hint">
            Connecting a server also turns it on for chat. Turn one off to keep it connected without
            loading its tools.
          </p>
          <ul className="mcp-server-list" role="list">
            {statuses.map((status) => (
              <McpServerRow
                key={status.config.id}
                status={status}
                active={activeConnectorNames.has(status.config.name)}
                onToggleActive={() =>
                  activeConnectorNames.has(status.config.name)
                    ? disableConnector(status.config.name)
                    : enableConnector(status.config.name)
                }
                onRemove={async () => {
                  // Confirmation is drawn in-pane by McpServerRow's ConfirmButton —
                  // window.confirm() is a silent no-op on Excel for Mac.
                  disableConnector(status.config.name);
                  await mcp.removeServer(status.config.id);
                }}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

interface McpAddFormProps {
  onAdd: (args: { name: string; url: string }) => Promise<void>;
  existingNames: string[];
}

function McpAddForm({ onAdd, existingNames }: McpAddFormProps) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validationError = useMemo(() => {
    if (!name && !url) return null;
    if (name && !isValidMcpServerName(name)) {
      return "Name must be lower-kebab — letters, digits, and hyphens only (e.g. 'acre-hub').";
    }
    if (existingNames.includes(name)) {
      return `An MCP server named "${name}" already exists.`;
    }
    if (url && !isValidMcpServerUrl(url)) {
      return "URL must be a valid http:// or https:// address.";
    }
    return null;
  }, [name, url, existingNames]);

  const canSubmit = name.length > 0 && url.length > 0 && !validationError && !busy;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd({ name, url });
      setName("");
      setUrl("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="mcp-add-form" onSubmit={handleSubmit}>
      <div className="mcp-add-form__row">
        <label className="mcp-add-form__field">
          <span className="mcp-add-form__label">Name</span>
          <input
            type="text"
            className="mcp-add-form__input"
            value={name}
            onChange={(e) => setName(e.target.value.toLowerCase())}
            placeholder="acre-hub"
            disabled={busy}
            spellCheck={false}
          />
        </label>
        <label className="mcp-add-form__field mcp-add-form__field--url">
          <span className="mcp-add-form__label">URL</span>
          <input
            type="text"
            className="mcp-add-form__input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/rpc"
            disabled={busy}
            spellCheck={false}
          />
        </label>
      </div>
      <div className="mcp-add-form__actions">
        <button type="submit" className="mcp-add-form__submit" disabled={!canSubmit}>
          {busy ? "Connecting…" : "Add Connector"}
        </button>
        {(validationError || error) && (
          <span className="mcp-add-form__error" role="alert">
            {validationError ?? error}
          </span>
        )}
      </div>
    </form>
  );
}

interface McpServerRowProps {
  status: McpServerStatus;
  /** Whether the user has this connector turned on (its tools reach the agent). */
  active: boolean;
  onToggleActive: () => void;
  onRemove: () => void;
}

function McpServerRow({ status, active, onToggleActive, onRemove }: McpServerRowProps) {
  const { config, state } = status;
  return (
    <li className={`mcp-server-row mcp-server-row--${state.status}${active ? " is-active" : ""}`}>
      <label
        className="mcp-server-row__toggle"
        title={
          active
            ? "On — this connector's tools are loaded into the agent. Click to turn off."
            : "Off — turn on to load this connector's tools into the agent."
        }
      >
        <input
          type="checkbox"
          checked={active}
          onChange={onToggleActive}
          aria-label={`Load ${config.name} into the agent`}
        />
      </label>
      <div className="mcp-server-row__main">
        <div className="mcp-server-row__name">{config.name}</div>
        <div className="mcp-server-row__url">{config.url}</div>
        <div className="mcp-server-row__status">
          <StatusIndicator status={state} />
        </div>
      </div>
      <ConfirmButton
        className="mcp-server-row__remove"
        question={`Remove "${config.name}"? Its tools will be unregistered.`}
        confirmLabel="Remove"
        onConfirm={onRemove}
        aria-label={`Remove ${config.name}`}
        title="Remove this MCP server"
      >
        ✕
      </ConfirmButton>
    </li>
  );
}

function StatusIndicator({ status }: { status: McpServerStatus["state"] }) {
  switch (status.status) {
    case "connecting":
      return <span className="mcp-status mcp-status--connecting">Connecting…</span>;
    case "connected":
      return (
        <span className="mcp-status mcp-status--connected">
          Connected · {status.toolCount} tool
          {status.toolCount === 1 ? "" : "s"}
        </span>
      );
    case "error":
      return (
        <span className="mcp-status mcp-status--error" title={status.message}>
          Error · {status.message.length > 60 ? `${status.message.slice(0, 57)}…` : status.message}
        </span>
      );
  }
}

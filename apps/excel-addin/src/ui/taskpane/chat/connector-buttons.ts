import { presetForServer, type McpPreset, type McpServerStatus } from "../../../core/mcp";

/**
 * Pure state derivation for the brand toggle buttons in the composer
 * toolbar (Vic, Hub). Kept out of the component so the three visual states
 * and their copy are unit-testable without a DOM.
 *
 *  - "on":    installed, connected, and in the active toolbelt → full-color mark.
 *  - "off":   installed and connected but toggled off → grayscale mark.
 *  - "connecting": toggled on, handshake in flight → dimmed color mark, still toggles.
 *  - "error": toggled on but the server errored → grayscale + dot; click opens the menu.
 *  Not installed → no button at all (the preset is simply absent).
 */
export type ConnectorButtonState = "on" | "off" | "connecting" | "error";

export interface ConnectorButton {
  preset: McpPreset;
  serverName: string;
  state: ConnectorButtonState;
  /** aria-label / title copy for the current state. */
  label: string;
  /** Error message when `state === "error"` (from the manager), if any. */
  detail?: string;
}

/** One entry per installed preset server, in preset order (stable across renders). */
export function connectorButtons(
  statuses: readonly McpServerStatus[],
  activeConnectorNames: ReadonlySet<string>,
  presets: readonly McpPreset[]
): ConnectorButton[] {
  const out: ConnectorButton[] = [];
  for (const preset of presets) {
    const status = statuses.find((s) => presetForServer(s, presets)?.id === preset.id);
    if (!status) continue;
    const name = status.config.name;
    const active = activeConnectorNames.has(name);
    const connected = status.state.status === "connected";

    if (!active) {
      out.push({
        preset,
        serverName: name,
        state: "off",
        label: `${preset.label} (${preset.shortLabel}) · Off. Click to turn on.`,
      });
      continue;
    }
    if (status.state.status === "connecting") {
      out.push({
        preset,
        serverName: name,
        state: "connecting",
        label: `${preset.label} (${preset.shortLabel}) · Connecting… Click to turn off.`,
      });
      continue;
    }
    if (!connected) {
      const detail = status.state.status === "error" ? status.state.message : "Not connected.";
      out.push({
        preset,
        serverName: name,
        state: "error",
        label: `${preset.label} (${preset.shortLabel}) · On but not connected: ${detail} Click to manage connectors.`,
        detail,
      });
      continue;
    }
    out.push({
      preset,
      serverName: name,
      state: "on",
      label: `${preset.label} (${preset.shortLabel}) · On. ${describeAuto(preset)} Click to turn off.`,
    });
  }
  return out;
}

function describeAuto(preset: McpPreset): string {
  if (preset.priming?.firstTurn) {
    return `${preset.shortLabel} is consulted at the start of each new chat.`;
  }
  if (preset.priming?.catalog) {
    return `${preset.shortLabel} data is available to the agent on every turn.`;
  }
  return "Its tools are available to the agent.";
}

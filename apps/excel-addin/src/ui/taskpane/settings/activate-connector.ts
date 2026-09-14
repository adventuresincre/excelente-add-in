/**
 * Connect (mcp.addServer) and enable (activeConnectorNames) are two
 * layers. Connecting registers the server's tools on the registry;
 * enabling puts those tools in the agent's allowlist via
 * `gateInactiveConnectors`.
 *
 * Until 2026-08-14 those were independent: Connect left the server off
 * in the composer "+" menu, so the user had to toggle it on in a second
 * step. A successful Connect now activates the connector so the next
 * chat turn sees its tools. The user can still turn it off without
 * disconnecting.
 *
 * App startup (`mcp.initialize`) must NOT call this — a connector the
 * user turned off stays off across reloads.
 */
export function shouldActivateAfterAdd(
  state:
    | {
        status: "connecting" | "connected" | "error";
      }
    | undefined
): boolean {
  return state?.status === "connected";
}

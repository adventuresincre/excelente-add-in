export { createMcpClient, McpClientError } from "./client";
export type { McpClient, McpTool, McpToolResult } from "./client";
export {
  bridgeMcpClient,
  bridgeMcpTool,
  mcpSourceTag,
  mcpToolName,
  MCP_SOURCE_PREFIX,
} from "./tool-bridge";
export { createMcpManager } from "./manager";
export type { McpManager, McpConnectionState, McpServerStatus } from "./manager";
export { ACRE_MCP_PRESETS } from "./presets";
export type {
  McpPreset,
  McpPresetConnect,
  McpPresetPriming,
  PrimingFirstTurnInput,
} from "./presets";
export {
  primeConnectors,
  presetForServer,
  shouldRunFirstTurn,
  clampInstructions,
  CONNECTOR_INSTRUCTIONS_MAX_CHARS,
  PRIMING_TIMEOUT_MS,
  CATALOG_RETRY_MS,
} from "./priming";
export type {
  ConnectorPrimingResult,
  PrimeConnectorsInput,
  PrimingCache,
  SeededToolCall,
} from "./priming";
export { runMcpOAuthFlow, refreshOAuthTokens, mcpRequiresAuth, McpOAuthError } from "./oauth";
export type { AuthWindowResult, McpOAuthTokens } from "./oauth";
export {
  openAuthWindowViaOfficeDialog,
  oauthRedirectUri,
  isOfficeDialogAvailable,
} from "./office-dialog";

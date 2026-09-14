/**
 * One-click A.CRE MCP connections offered in Settings. Bundled client-side
 * (not config-driven) because `config.member.mcp[]` is only delivered
 * after a member authenticates — these buttons must render pre-auth, since
 * clicking one is what starts the sign-in.
 *
 * Two connection shapes exist in the A.CRE ecosystem:
 *  - "oauth": a fixed endpoint that runs its own hosted sign-in (email +
 *    emailed code) via standard MCP OAuth — the dialog flow in oauth.ts.
 *  - "personal-url": each member has a personal MCP URL with the
 *    credential embedded; they paste it and the connection is automatic.
 *
 * Presets also carry a *priming* recipe (see priming.ts): how the harness
 * invokes the connector automatically once the user has it on, so a Vic or
 * Hub member never has to ask the agent to use the service they enabled.
 */

export type McpPresetConnect =
  | { kind: "oauth"; url: string }
  | {
      kind: "personal-url";
      /** Helper line shown above the URL input. */
      help: string;
      /** Where members find their personal URL. */
      links: Array<{ label: string; url: string }>;
    };

/** Inputs available to a first-turn recipe when it builds tool arguments. */
export interface PrimingFirstTurnInput {
  /** The user's message text for this turn (raw, without the selection note). */
  userText: string;
  /** Active worksheet name when the selection is known; null otherwise. */
  sheetName: string | null;
}

/**
 * How the harness primes a connector without being asked. Every field is
 * optional except `rule`; a preset with no `firstTurn` and no `catalog`
 * still gets its server instructions and the rule into the prompt.
 */
export interface McpPresetPriming {
  /**
   * Run this tool on the first user turn of a conversation (and on any
   * later turn whose text matches `mentions`). The call and its result are
   * seeded into the transcript as an automatic tool call, so the model
   * sees the answer on its very first inference instead of spending a
   * round trip asking for it.
   */
  firstTurn?: {
    /** Bare MCP tool name (no `mcp_<server>__` prefix). */
    tool: string;
    args: (input: PrimingFirstTurnInput) => Record<string, unknown>;
    /** One-line transcript summary for the seeded tool line. */
    summary: (result: unknown) => string;
  };
  /** Re-trigger `firstTurn` on a later turn when the user names the service. */
  mentions?: RegExp;
  /**
   * Run this tool once per connection and place the formatted result in
   * the system prompt on every turn. `format` returns null to omit the
   * block (unparseable result); keep the output to a few hundred tokens —
   * it is cached behind the system-prompt breakpoint but still paid once.
   */
  catalog?: {
    tool: string;
    args?: Record<string, unknown>;
    format: (result: unknown) => string | null;
  };
  /** One-line harness rule appended to this connector's prompt section. */
  rule: string;
}

export interface McpPreset {
  /** Stable id persisted on the server config (`McpServerConfig.presetId`). */
  id: string;
  /** Server name — becomes the tool prefix (`mcp_${name}__…`); must pass
   * `isValidMcpServerName`. */
  name: string;
  /** Display label for the Settings row. */
  label: string;
  /** Two-to-four character label for compact UI (tooltips, transcript). */
  shortLabel: string;
  /** One-line description shown under the label. */
  description: string;
  /**
   * Brand mark, served from `public/assets/connectors/`. `small` is tuned
   * for 16–24px (heavier strokes); `large` is the faithful cut for 32px+.
   */
  icon: { small: string; large: string };
  connect: McpPresetConnect;
  priming?: McpPresetPriming;
}

/** Bridged MCP tools return text; the A.CRE servers return JSON text. */
function parseJsonResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result) as unknown;
  } catch {
    return null;
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : `${oneLine.slice(0, max - 1)}…`;
}

/** `discover_tasks` → "Asked Vic which tasks fit · 5 matches". */
function summarizeDiscoverTasks(result: unknown): string {
  const parsed = parseJsonResult(result) as { candidates?: unknown[] } | null;
  const n = Array.isArray(parsed?.candidates) ? parsed.candidates.length : null;
  return n === null
    ? "Asked Vic which tasks fit"
    : `Asked Vic which tasks fit · ${n} ${n === 1 ? "match" : "matches"}`;
}

/** `list_data` → one line per data source, endpoints dropped (~300 tokens). */
function formatHubCatalog(result: unknown): string | null {
  const parsed = parseJsonResult(result) as {
    data_sources?: Array<{ slug?: unknown; displayName?: unknown; description?: unknown }>;
  } | null;
  const sources = parsed?.data_sources;
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const lines: string[] = [];
  for (const s of sources) {
    if (typeof s?.slug !== "string") continue;
    const name = typeof s.displayName === "string" ? ` (${s.displayName})` : "";
    const desc = typeof s.description === "string" ? `: ${truncate(s.description, 140)}` : "";
    lines.push(`- ${s.slug}${name}${desc}`);
  }
  if (lines.length === 0) return null;
  return [
    "Data catalog (from list_data; call get_data_docs <slug> before query_data):",
    ...lines,
  ].join("\n");
}

export const ACRE_MCP_PRESETS: readonly McpPreset[] = [
  {
    id: "cre-agents",
    name: "cre-agents",
    label: "CRE Agents",
    shortLabel: "Vic",
    description:
      "CRE Agents (Vic) equips your AI with the data, methods, and ready-to-run tasks to do CRE work better, faster, and cheaper.",
    icon: {
      small: "/assets/connectors/cre-agents.svg",
      large: "/assets/connectors/cre-agents.svg",
    },
    connect: { kind: "oauth", url: "https://app.creagents.com/api/mcp" },
    priming: {
      firstTurn: {
        tool: "discover_tasks",
        args: ({ userText, sheetName }) => ({
          request: userText,
          environment: "excel",
          ...(sheetName ? { context: `Working in Excel; active sheet: ${sheetName}` } : {}),
        }),
        summary: summarizeDiscoverTasks,
      },
      mentions: /\b(vic|cre agents)\b/i,
      rule: "Vic (CRE Agents) is on. When a discover_tasks result already sits under the user's message, it was run for you — commit the best match with get_task and follow its orchestration prompt; if nothing fits a small or non-CRE request, proceed without Vic and say so in one line. Do not re-run discover_tasks for the same request.",
    },
  },
  {
    id: "acre-intelligence-hub",
    name: "acre-intelligence-hub",
    label: "A.CRE Intelligence Hub",
    shortLabel: "Hub",
    description:
      "Primary-source CRE data — market, employment, climate risk, rates — plus expert analysis skills from A.CRE.",
    icon: {
      small: "/assets/connectors/acre-small.svg",
      large: "/assets/connectors/acre.svg",
    },
    connect: {
      kind: "personal-url",
      help: "Paste your personal Intelligence Hub MCP URL — it connects automatically.",
      links: [
        { label: "A.CRE Accelerator", url: "https://app.adventuresincre.ai" },
        { label: "AI.Edge Pro", url: "https://members.aiedge.ac" },
      ],
    },
    priming: {
      catalog: { tool: "list_data", format: formatHubCatalog },
      rule: "The A.CRE Intelligence Hub is on. For rates, demographics, employment, migration, permits, physical risk, or federal incentives, use Hub data instead of assumptions or web memory: get_data_docs for the source, then query_data. For CRE methodology beyond the skill index, search_skills first.",
    },
  },
];

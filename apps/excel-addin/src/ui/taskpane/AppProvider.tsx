import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createIndexedDbConversationStore,
  createIndexedDbMcpServerStore,
  createInMemoryConversationStore,
  createInMemoryMcpServerStore,
  createSettingsStore,
  getWorkbookId,
  type ConversationStore,
  type McpServerStore,
  type ModelPref,
  type SettingsStore,
  type StorageBackend,
} from "../../core/storage";
import { createMcpManager, type McpManager } from "../../core/mcp";
import {
  attachExcelEventBridge,
  createHookRegistry,
  type HookRegistry,
} from "../../core/hooks";
import {
  createOpenRouterClient,
  type OpenRouterClient,
  type Usage,
} from "../../core/openrouter";
import { officeDataSource, type ExcelDataSource } from "../../core/context";
import {
  createToolRegistry,
  createUndoStack,
  readTools,
  writeTools,
  screenshotTools,
  planTools,
  spawnSubagentTool,
  readSkillResourceTool,
  findSkillTool,
  loadSkillTool,
  memoryTools,
  enterPlanModeTool,
  workbookSettingsTools,
  askUserQuestionTool,
  runExcelScriptTool,
  todoWriteTool,
  proposeSkillTool,
  type ToolRegistry,
  type UndoStack,
} from "../../core/tools";
import {
  bundledSkillSource,
  sharedBundledFiles,
  withExtraSkillFiles,
  createInMemorySkillStore,
  createIndexedDbSkillStore,
  createSkillRegistry,
  installSkillFromZip,
  userSkillSource,
  type InstallResult,
  type SkillRegistry,
  type SkillStore,
} from "../../core/skills";
import { createPdfRasterizer, type PdfRasterizer } from "../../core/vision";
import { resolveRunningPref } from "./pending-model";
import { edition } from "@edition";
import {
  createAuthClient,
  createSessionStore,
  isSessionValid,
  type AuthClient,
  type Session,
  type SessionStore,
} from "../../core/auth";

export type ChatMode = "plan" | "work";

/**
 * Per-model session stats. Aggregated input + cache-read tokens for each
 * model the agent has called this session. Used by /cost popover to show
 * per-model cache hit rates so the user can verify caching is working
 * (especially for Wave 10b's expectation that every supported family
 * caches via OpenRouter).
 */
export interface PerModelStat {
  /** Total prompt (input) tokens billed across all calls to this model. */
  promptTokens: number;
  /** Tokens served from cache — billed at ~10% of full input rate. */
  cacheReadTokens: number;
  /** Tokens written to cache this session — small surcharge over input. */
  cacheCreationTokens: number;
  /** Total completion (output) tokens this session. */
  completionTokens: number;
  /** Running USD spent on this model this session. */
  cost: number;
  /** Number of completed turns through this model. */
  calls: number;
}

export interface AppContextValue {
  /** True until the initial settings load completes. */
  loading: boolean;
  apiKey: string | null;
  /** The stored choice. What Settings shows and edits. */
  modelPref: ModelPref | null;
  /**
   * What actually drives requests: the choice when a key exists, the
   * edition's keyless fallback (or nothing) when it does not. Everything
   * that sends a request reads this one.
   */
  runningModelPref: ModelPref | null;
  /** The chosen model that is waiting for a key, or null. */
  pendingModelId: string | null;
  setApiKey: (key: string) => Promise<void>;
  clearApiKey: () => Promise<void>;
  setModelPref: (pref: ModelPref) => Promise<void>;
  openrouter: OpenRouterClient;
  /** Plan vs. Work mode for the chat. Plan = read-only + ask for a numbered plan. */
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  /** Excel data source — Office.js in production, an in-memory stub in tests. */
  ds: ExcelDataSource;
  /** Registered Excel tools. */
  registry: ToolRegistry;
  /** Snapshot stack for the `undo` tool. */
  undoStack: UndoStack;
  /** Registered Open Agent Skills (bundled + user-installed). */
  skillRegistry: SkillRegistry;
  /** Bumped whenever the user-skill set changes — UI deps on this to refresh. */
  skillsVersion: number;
  /** Install a skill from a .zip blob. Throws SkillZipError on validation failure. */
  installSkill: (blob: Blob) => Promise<InstallResult>;
  /**
   * Install a skill from a structured proposal (used by `propose_skill`).
   * Writes directly to the user-skill store. Bumps
   * `skillsVersion` so `find_skill` / sidebar reflect the new addition.
   */
  installSkillFromProposal: (proposal: {
    name: string;
    description: string;
    whenToUse?: string;
    body: string;
    references?: Record<string, string>;
  }) => Promise<{ name: string; replaced: boolean }>;
  /** Remove a user-installed skill by name. No-op if not installed. */
  uninstallSkill: (name: string) => Promise<void>;
  /**
   * Names of skills the user has turned on. Persisted per-user (opt-in,
   * sticky until turned off) and summary-injected into the system prompt
   * every turn.
   */
  enabledSkillNames: ReadonlySet<string>;
  enableSkill: (name: string) => void;
  disableSkill: (name: string) => void;
  /**
   * Names of connected MCP servers (connectors) whose tools are exposed to
   * the agent. A successful Connect (Plan → Connectors, or a custom add)
   * adds the server here so its tools reach the next chat turn. The user
   * can turn one off without disconnecting; that choice is sticky across
   * reloads. A server must also be connected (see `mcp`) for its tools to
   * exist; this set gates which connected servers the agent actually sees.
   */
  activeConnectorNames: ReadonlySet<string>;
  enableConnector: (name: string) => void;
  disableConnector: (name: string) => void;
  /** Rasterizes PDF attachments into images. */
  pdfRasterizer: PdfRasterizer;
  /** Running USD total for usages that arrived this session. */
  sessionCost: number;
  /**
   * Prompt-cache stats accumulated across the session. `read` is tokens
   * served from cache (billed at ~10% of full input rate); `created` is
   * tokens written to cache this session (a small surcharge). Both update
   * via `recordUsage`. Surfaced in the `/cost` popover.
   */
  cacheStats: { read: number; created: number };
  /**
   * Per-model breakdown of session usage. Keyed by modelId. Lets the UI
   * show "Sonnet 4.6: 80% cache hit, Kimi K2.6: 65% hit" so the user
   * can verify each model in their setup is actually caching. Wave 10b.
   */
  perModelStats: Record<string, PerModelStat>;
  recordUsage: (usage: Usage, modelId: string) => void;
  resetSession: () => void;
  /** Conversation persistence store. */
  conversationStore: ConversationStore;
  /** Workbook id for scoping conversation history. */
  workbookId: string;
  /** MCP manager — owns the lifecycle of MCP server connections. */
  mcp: McpManager;
  /**
   * A.CRE member session, or null when signed out (or the persisted token
   * was already expired at load). Member-token MCP servers and (later) the
   * relay read the live token through the provider's internal ref, so a
   * sign-in mid-session takes effect without reconnects.
   */
  session: Session | null;
  /** Persist + adopt a session returned by the auth flow (verify-code). */
  completeSignIn: (session: Session) => Promise<void>;
  /** Intel Hub auth client for the email one-time-code sign-in flow. */
  authClient: AuthClient;
  /** Member-session persistence — exposes the email hint for re-auth prefill. */
  sessionStore: SessionStore;
  /** Hook registry — handlers subscribe to SessionStart / PreToolUse /
   * PostToolUse / WorkbookSaved / SheetChanged here. Shared across the
   * app. */
  hooks: HookRegistry;
  /**
   * Register a getter the Excel-event bridge uses to attach the active
   * conversation id to WorkbookSaved / SheetChanged hook contexts. The
   * chat hook calls this on mount with a function that returns its
   * current conversationId state.
   */
  registerConversationIdGetter: (getter: () => string | null) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export interface AppProviderProps {
  children: React.ReactNode;
  /** Override storage backend (tests). */
  storageBackend?: StorageBackend;
  /** Override the OpenRouter client (tests). */
  openrouter?: OpenRouterClient;
  /** Override the Excel data source (tests). */
  ds?: ExcelDataSource;
  /** Override the skill registry (tests). */
  skillRegistry?: SkillRegistry;
  /** Override the skill store (tests). */
  skillStore?: SkillStore;
  /** Override the conversation store (tests). */
  conversationStore?: ConversationStore;
  /** Override workbook id (tests). */
  workbookId?: string;
  /** Override the MCP server store (tests). */
  mcpServerStore?: McpServerStore;
  /** Override the PDF rasterizer (tests). */
  pdfRasterizer?: PdfRasterizer;
  /** Override the member session store (tests). */
  sessionStore?: SessionStore;
  /** Override the Intel Hub auth client (tests). */
  authClient?: AuthClient;
}

/**
 * Pick a `SkillStore` for production. Prefer IndexedDB; fall back to an
 * in-memory store if it isn't available (e.g., a webview without storage
 * permission). The fallback is best-effort — user-installed skills won't
 * persist across reloads — and a console warning makes that visible.
 */
function defaultSkillStore(): SkillStore {
  if (typeof indexedDB !== "undefined") {
    return createIndexedDbSkillStore();
  }
  console.warn(
    "IndexedDB unavailable. User-installed skills will not persist across reloads."
  );
  return createInMemorySkillStore();
}

function defaultConversationStore(): ConversationStore {
  if (typeof indexedDB !== "undefined") {
    return createIndexedDbConversationStore();
  }
  console.warn(
    "IndexedDB unavailable. Chat history will not persist across reloads."
  );
  return createInMemoryConversationStore();
}

function defaultMcpServerStore(): McpServerStore {
  if (typeof indexedDB !== "undefined") {
    return createIndexedDbMcpServerStore();
  }
  console.warn(
    "IndexedDB unavailable. MCP server configs will not persist across reloads."
  );
  return createInMemoryMcpServerStore();
}

export function AppProvider({
  children,
  storageBackend,
  openrouter,
  ds: dsOverride,
  skillRegistry: skillRegistryOverride,
  skillStore: skillStoreOverride,
  conversationStore: conversationStoreOverride,
  workbookId: workbookIdOverride,
  mcpServerStore: mcpServerStoreOverride,
  pdfRasterizer: pdfRasterizerOverride,
  sessionStore: sessionStoreOverride,
  authClient: authClientOverride,
}: AppProviderProps) {
  const store: SettingsStore = useMemo(
    () => createSettingsStore(storageBackend),
    [storageBackend]
  );
  const client = useMemo(() => openrouter ?? createOpenRouterClient(), [openrouter]);
  const ds = useMemo(() => dsOverride ?? officeDataSource(), [dsOverride]);
  const undoStack = useMemo(() => createUndoStack(), []);
  const registry = useMemo(
    () =>
      createToolRegistry([
        ...readTools,
        ...writeTools,
        ...screenshotTools,
        ...planTools,
        spawnSubagentTool,
        readSkillResourceTool,
        findSkillTool,
        loadSkillTool,
        ...memoryTools,
        ...workbookSettingsTools,
        enterPlanModeTool,
        askUserQuestionTool,
        runExcelScriptTool,
        todoWriteTool,
        proposeSkillTool,
      ]),
    []
  );
  const skillStore = useMemo(
    () => skillStoreOverride ?? defaultSkillStore(),
    [skillStoreOverride]
  );
  // The shared skills plus whatever this edition bundles on top (the acre
  // edition adds the nine CRE Agents skills). Composed here, at the root,
  // so `core/skills` never learns which edition it is in.
  const bundledSource = useMemo(
    () => bundledSkillSource(withExtraSkillFiles(sharedBundledFiles(), edition.bundledSkills)),
    []
  );
  const userSource = useMemo(() => userSkillSource(skillStore), [skillStore]);
  const skillRegistry = useMemo(
    () => skillRegistryOverride ?? createSkillRegistry([bundledSource, userSource]),
    [skillRegistryOverride, bundledSource, userSource]
  );
  const pdfRasterizer = useMemo(
    () => pdfRasterizerOverride ?? createPdfRasterizer(),
    [pdfRasterizerOverride]
  );
  const conversationStore = useMemo(
    () => conversationStoreOverride ?? defaultConversationStore(),
    [conversationStoreOverride]
  );
  const workbookId = useMemo(
    () => workbookIdOverride ?? getWorkbookId(),
    [workbookIdOverride]
  );
  const mcpServerStore = useMemo(
    () => mcpServerStoreOverride ?? defaultMcpServerStore(),
    [mcpServerStoreOverride]
  );
  const sessionStore = useMemo(
    () => sessionStoreOverride ?? createSessionStore(storageBackend),
    [sessionStoreOverride, storageBackend]
  );
  const authClient = useMemo(
    () => authClientOverride ?? createAuthClient(),
    [authClientOverride]
  );
  // Live token handle for member-token MCP servers. A ref (not state) so the
  // manager's per-request getter always sees the latest token without the
  // manager being recreated on sign-in.
  const sessionRef = useRef<Session | null>(null);
  const [session, setSessionState] = useState<Session | null>(null);
  const mcp = useMemo(
    () =>
      createMcpManager({
        store: mcpServerStore,
        registry,
        getAuthToken: () => sessionRef.current?.token ?? null,
      }),
    [mcpServerStore, registry]
  );
  const hooks = useMemo(() => createHookRegistry(), []);
  // Mutable handle the chat hook updates when it mints / clears a
  // conversation id. The Excel-event bridge calls it on each WorkbookSaved
  // / SheetChanged so handlers receive the active conversation context
  // even though those events originate outside the chat flow.
  const conversationIdRef = useRef<() => string | null>(() => null);

  // Load the persisted member session BEFORE connecting MCP servers, so
  // member-token servers authenticate on the boot connect instead of
  // 401-ing and needing a manual retry. The manager's initialize() is
  // idempotent — calling it again on hot-reload only reconnects servers
  // that aren't already connected.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const persisted = await sessionStore.get();
        if (!cancelled && isSessionValid(persisted)) {
          sessionRef.current = persisted;
          setSessionState(persisted);
        }
      } catch (e) {
        console.warn(`Member session load failed: ${(e as Error).message}`);
      }
      await mcp.initialize().catch((e) => {
        console.warn(`MCP manager initialize failed: ${(e as Error).message}`);
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [mcp, sessionStore]);

  const completeSignIn = useCallback(
    async (next: Session) => {
      await sessionStore.set(next);
      sessionRef.current = next;
      setSessionState(next);
    },
    [sessionStore]
  );

  // Wire Office.js workbook-saved + sheet-changed events into the hook
  // registry. The bridge unsubscribes on unmount so hot-reload doesn't
  // leak registrations against the live worksheet objects.
  useEffect(() => {
    const detach = attachExcelEventBridge({
      ds,
      hooks,
      getConversationId: () => conversationIdRef.current(),
    });
    return () => detach();
  }, [ds, hooks]);

  const registerConversationIdGetter = useCallback(
    (getter: () => string | null) => {
      conversationIdRef.current = getter;
    },
    []
  );

  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [modelPref, setModelPrefState] = useState<ModelPref | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionCost, setSessionCost] = useState(0);
  const [cacheStats, setCacheStats] = useState<{ read: number; created: number }>(
    { read: 0, created: 0 }
  );
  const [perModelStats, setPerModelStats] = useState<Record<string, PerModelStat>>({});
  const [enabledSkillNames, setEnabledSkillNames] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [activeConnectorNames, setActiveConnectorNames] = useState<ReadonlySet<string>>(
    () => new Set<string>()
  );
  const [skillsVersion, setSkillsVersion] = useState(0);
  const [chatMode, setChatMode] = useState<ChatMode>("work");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [k, pref, caps] = await Promise.all([
          store.getApiKey(),
          store.getModelPref(),
          store.getActiveCapabilities(),
        ]);
        if (cancelled) return;
        setApiKeyState(k);
        setModelPrefState(pref);
        // Seed the active toolbelt from the persisted record so a user's
        // favorite skills + connectors are already on at launch.
        setEnabledSkillNames(new Set(caps.skills));
        setActiveConnectorNames(new Set(caps.connectors));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  // Persist the active toolbelt whenever either set changes. Running it as an
  // effect (rather than inside each toggle) means it always sees committed
  // state — no stale-ref reads, no lost update when skills and connectors
  // change close together. Gated on `!loading` so the initial empty sets
  // can't clobber the persisted record before the boot load seeds them
  // (the boot effect flips `loading` false only after seeding both sets).
  useEffect(() => {
    if (loading) return;
    void store
      .setActiveCapabilities({
        skills: [...enabledSkillNames],
        connectors: [...activeConnectorNames],
      })
      .catch((e) => {
        console.warn(`Failed to persist active capabilities: ${(e as Error).message}`);
      });
  }, [enabledSkillNames, activeConnectorNames, loading, store]);

  const setApiKey = useCallback(
    async (key: string) => {
      await store.setApiKey(key);
      setApiKeyState(key);
    },
    [store]
  );

  const clearApiKey = useCallback(async () => {
    await store.clearApiKey();
    setApiKeyState(null);
  }, [store]);

  const setModelPref = useCallback(
    async (pref: ModelPref) => {
      await store.setModelPref(pref);
      setModelPrefState(pref);
    },
    [store]
  );

  // Toggles are pure set updates; the persist effect above mirrors any change
  // to storage.
  const enableSkill = useCallback((name: string) => {
    setEnabledSkillNames((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const disableSkill = useCallback((name: string) => {
    setEnabledSkillNames((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const enableConnector = useCallback((name: string) => {
    setActiveConnectorNames((prev) => {
      if (prev.has(name)) return prev;
      const next = new Set(prev);
      next.add(name);
      return next;
    });
  }, []);

  const disableConnector = useCallback((name: string) => {
    setActiveConnectorNames((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  const installSkill = useCallback(
    async (blob: Blob) => {
      // Reserve every bundled name — they win over user uploads.
      const bundledList = await bundledSource.list();
      const reservedNames = new Set(bundledList.map((s) => s.name));
      const result = await installSkillFromZip(blob, skillStore, { reservedNames });
      setSkillsVersion((v) => v + 1);
      return result;
    },
    [bundledSource, skillStore]
  );

  const installSkillFromProposal = useCallback(
    async (proposal: {
      name: string;
      description: string;
      whenToUse?: string;
      body: string;
      references?: Record<string, string>;
    }) => {
      // Same reserved-name rule as installSkill — bundled names win.
      const bundledList = await bundledSource.list();
      const reservedNames = new Set(bundledList.map((s) => s.name));
      if (reservedNames.has(proposal.name)) {
        throw new Error(
          `A bundled skill is named "${proposal.name}". The agent should pick a different name (e.g. "${proposal.name}-custom") or propose_skill with kind="update" on an existing USER skill.`
        );
      }
      // Skill names must be lower-kebab-safe. The validator lives in
      // install.ts; replicate the regex here so we don't have to thread
      // through SkillZipError construction.
      if (!/^[a-z][a-z0-9-]*$/.test(proposal.name)) {
        throw new Error(
          `Skill name "${proposal.name}" is invalid. Use lowercase letters, digits, and hyphens only (e.g. "underwriting-checklist").`
        );
      }
      const existing = await skillStore.get(proposal.name);
      const mergedResources = {
        ...(existing?.resources ?? {}),
        ...(proposal.references ?? {}),
      };
      const record = {
        name: proposal.name,
        frontmatter: {
          name: proposal.name,
          description: proposal.description,
          whenToUse: proposal.whenToUse,
          version: existing?.frontmatter.version,
          author: existing?.frontmatter.author ?? "Excelente (agent-proposed)",
        },
        body: proposal.body,
        resources: mergedResources,
        installedAt: Date.now(),
      };
      await skillStore.put(record);
      setSkillsVersion((v) => v + 1);
      return { name: proposal.name, replaced: existing !== null };
    },
    [bundledSource, skillStore]
  );

  const uninstallSkill = useCallback(
    async (name: string) => {
      await skillStore.delete(name);
      // Drop it from the active set if it was enabled — the persist effect
      // mirrors the change so an uninstalled skill doesn't linger in the
      // saved toolbelt.
      setEnabledSkillNames((prev) => {
        if (!prev.has(name)) return prev;
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
      setSkillsVersion((v) => v + 1);
    },
    [skillStore]
  );

  const recordUsage = useCallback((usage: Usage, modelId: string) => {
    if (typeof usage.cost === "number" && Number.isFinite(usage.cost)) {
      setSessionCost((c) => c + usage.cost!);
    }
    const read =
      typeof usage.cacheReadTokens === "number" ? usage.cacheReadTokens : 0;
    const created =
      typeof usage.cacheCreationTokens === "number"
        ? usage.cacheCreationTokens
        : 0;
    const prompt = typeof usage.promptTokens === "number" ? usage.promptTokens : 0;
    const completion =
      typeof usage.completionTokens === "number" ? usage.completionTokens : 0;
    const cost =
      typeof usage.cost === "number" && Number.isFinite(usage.cost) ? usage.cost : 0;

    if (read > 0 || created > 0) {
      setCacheStats((s) => ({ read: s.read + read, created: s.created + created }));
    }

    // Per-model tally so /cost can show cache hit rate per model. Wave 10b.
    setPerModelStats((prev) => {
      const existing = prev[modelId] ?? {
        promptTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        completionTokens: 0,
        cost: 0,
        calls: 0,
      };
      return {
        ...prev,
        [modelId]: {
          promptTokens: existing.promptTokens + prompt,
          cacheReadTokens: existing.cacheReadTokens + read,
          cacheCreationTokens: existing.cacheCreationTokens + created,
          completionTokens: existing.completionTokens + completion,
          cost: existing.cost + cost,
          calls: existing.calls + 1,
        },
      };
    });

    // Dev-mode diagnostic so we can see per-request cache behavior in the
    // browser console. Filtered to console.debug so it doesn't pollute
    // normal logs. Useful when verifying a new model family is actually
    // hitting cache.
    if (read > 0 || created > 0) {
      const hitPct = prompt > 0 ? Math.round((read / prompt) * 100) : 0;
      console.debug(
        `[cache] ${modelId} prompt=${prompt} read=${read} created=${created} hit=${hitPct}%`
      );
    }
  }, []);

  const resetSession = useCallback(() => {
    setSessionCost(0);
    setCacheStats({ read: 0, created: 0 });
    setPerModelStats({});
  }, []);

  const { running: runningModelPref, pendingModelId } = useMemo(
    () => resolveRunningPref(modelPref, apiKey, edition),
    [modelPref, apiKey]
  );

  const value: AppContextValue = useMemo(
    () => ({
      loading,
      apiKey,
      modelPref,
      runningModelPref,
      pendingModelId,
      setApiKey,
      clearApiKey,
      setModelPref,
      openrouter: client,
      chatMode,
      setChatMode,
      ds,
      registry,
      undoStack,
      skillRegistry,
      skillsVersion,
      installSkill,
      installSkillFromProposal,
      uninstallSkill,
      enabledSkillNames,
      enableSkill,
      disableSkill,
      activeConnectorNames,
      enableConnector,
      disableConnector,
      pdfRasterizer,
      sessionCost,
      cacheStats,
      perModelStats,
      recordUsage,
      resetSession,
      conversationStore,
      workbookId,
      mcp,
      session,
      completeSignIn,
      authClient,
      sessionStore,
      hooks,
      registerConversationIdGetter,
    }),
    [
      loading,
      apiKey,
      modelPref,
      runningModelPref,
      pendingModelId,
      setApiKey,
      clearApiKey,
      setModelPref,
      client,
      chatMode,
      ds,
      registry,
      undoStack,
      skillRegistry,
      skillsVersion,
      installSkill,
      installSkillFromProposal,
      uninstallSkill,
      conversationStore,
      workbookId,
      mcp,
      session,
      completeSignIn,
      authClient,
      sessionStore,
      hooks,
      registerConversationIdGetter,
      enabledSkillNames,
      enableSkill,
      disableSkill,
      activeConnectorNames,
      enableConnector,
      disableConnector,
      pdfRasterizer,
      sessionCost,
      cacheStats,
      perModelStats,
      recordUsage,
      resetSession,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) {
    throw new Error("useApp must be used inside <AppProvider>");
  }
  return v;
}

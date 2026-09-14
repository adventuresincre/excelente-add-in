export type ReasoningLevel = "off" | "low" | "medium" | "high";

export interface ModelPref {
  /** Primary model — drives the main agent loop. */
  modelId: string;
  reasoning: ReasoningLevel;
  /**
   * Optional override for sub-agent dispatch (Explore / Audit / Builder /
   * Reviewer). When omitted, sub-agents run on `modelId`. A different model
   * here is most useful for the Reviewer subagent — cross-architecture
   * verification surfaces blind spots a same-model review would miss.
   */
  subagentModelId?: string;
  /**
   * Optional vision-model override. When set, any tool that produces image
   * content (e.g. the `screenshot` tool) sends its
   * image to this model in a one-shot call and returns the model's text
   * response to the primary. This keeps the primary's conversation history
   * text-only — required when the primary doesn't accept image input, and
   * still useful when it does because it unlocks more aggressive prompt
   * caching on the primary stream.
   */
  visionModelId?: string;
  /**
   * Optional summary-model override. Drives the conversation-compaction
   * meta-call that fires when the running token estimate crosses ~200k.
   * Defaults to the primary; a cheaper model (Haiku, Qwen-Turbo) brings
   * per-compaction cost down meaningfully since summarization doesn't
   * need top-tier reasoning and only fires on long sessions.
   */
  summaryModelId?: string;
  /**
   * Max model turns per send before the agent pauses and offers a
   * "Continue Working" button. Higher = the agent does more in one go
   * before pausing; lower = it checks in more often. Defaults to 200.
   * Stored as a plain number; the Settings UI presents it in friendly
   * language ("how much the agent does before pausing").
   */
  maxTurns?: number;
}

export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * The user's persisted "active toolbelt" — which Skills and which Connectors
 * (MCP servers, keyed by name) are turned on for the agent. Opt-in: empty by
 * default, sticky until the user changes it. Stored in the same per-user
 * `OfficeRuntime.storage` as the API key / model pref, so a user's favorite
 * skills and connectors stay on across new chats and across reopening the
 * workbook — until they turn them off.
 */
export interface ActiveCapabilities {
  /** Names of skills summary-injected into the system prompt every turn. */
  skills: string[];
  /** Names of connected MCP servers whose tools are exposed to the agent. */
  connectors: string[];
}

export interface SettingsStore {
  getApiKey(): Promise<string | null>;
  setApiKey(key: string): Promise<void>;
  clearApiKey(): Promise<void>;
  getModelPref(): Promise<ModelPref | null>;
  setModelPref(pref: ModelPref): Promise<void>;
  /** The user's active skills + connectors. Returns empty arrays when unset. */
  getActiveCapabilities(): Promise<ActiveCapabilities>;
  setActiveCapabilities(value: ActiveCapabilities): Promise<void>;
}

const KEY_API = "excelente.openrouter.apiKey";
const KEY_MODEL_PREF = "excelente.openrouter.modelPref";
const KEY_CAPABILITIES = "excelente.capabilities.active";

const REASONING_LEVELS: readonly ReasoningLevel[] = ["off", "low", "medium", "high"];

export function createSettingsStore(backend: StorageBackend = officeBackend()): SettingsStore {
  return {
    async getApiKey() {
      return backend.getItem(KEY_API);
    },
    async setApiKey(key) {
      if (!key.trim()) {
        throw new Error("API key cannot be empty");
      }
      await backend.setItem(KEY_API, key);
    },
    async clearApiKey() {
      await backend.removeItem(KEY_API);
    },
    async getModelPref() {
      const raw = await backend.getItem(KEY_MODEL_PREF);
      if (!raw) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isObject(parsed)) return null;
        const obj = parsed as Record<string, unknown>;
        const { modelId, reasoning, subagentModelId, visionModelId, summaryModelId, maxTurns } =
          obj;
        if (typeof modelId !== "string" || !modelId) return null;
        if (!isReasoningLevel(reasoning)) return null;
        const pref: ModelPref = { modelId, reasoning };
        if (typeof subagentModelId === "string" && subagentModelId) {
          pref.subagentModelId = subagentModelId;
        }
        if (typeof visionModelId === "string" && visionModelId) {
          pref.visionModelId = visionModelId;
        }
        if (typeof summaryModelId === "string" && summaryModelId) {
          pref.summaryModelId = summaryModelId;
        }
        if (typeof maxTurns === "number" && Number.isFinite(maxTurns) && maxTurns > 0) {
          pref.maxTurns = Math.round(maxTurns);
        }
        return pref;
      } catch {
        return null;
      }
    },
    async setModelPref(pref) {
      if (!pref.modelId.trim()) {
        throw new Error("modelId is required");
      }
      if (!isReasoningLevel(pref.reasoning)) {
        throw new Error(`invalid reasoning level: ${String(pref.reasoning)}`);
      }
      // Strip empty overrides so they round-trip as undefined rather than "".
      const payload: ModelPref = {
        modelId: pref.modelId,
        reasoning: pref.reasoning,
      };
      if (pref.subagentModelId && pref.subagentModelId.trim()) {
        payload.subagentModelId = pref.subagentModelId;
      }
      if (pref.visionModelId && pref.visionModelId.trim()) {
        payload.visionModelId = pref.visionModelId;
      }
      if (pref.summaryModelId && pref.summaryModelId.trim()) {
        payload.summaryModelId = pref.summaryModelId;
      }
      if (
        typeof pref.maxTurns === "number" &&
        Number.isFinite(pref.maxTurns) &&
        pref.maxTurns > 0
      ) {
        payload.maxTurns = Math.round(pref.maxTurns);
      }
      await backend.setItem(KEY_MODEL_PREF, JSON.stringify(payload));
    },
    async getActiveCapabilities() {
      const raw = await backend.getItem(KEY_CAPABILITIES);
      if (!raw) return { skills: [], connectors: [] };
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isObject(parsed)) return { skills: [], connectors: [] };
        return {
          skills: toStringArray(parsed.skills),
          connectors: toStringArray(parsed.connectors),
        };
      } catch {
        return { skills: [], connectors: [] };
      }
    },
    async setActiveCapabilities(value) {
      // Normalize on write — drop non-strings / empties and de-dupe so the
      // persisted record stays clean regardless of caller hygiene.
      const payload: ActiveCapabilities = {
        skills: toStringArray(value.skills),
        connectors: toStringArray(value.connectors),
      };
      await backend.setItem(KEY_CAPABILITIES, JSON.stringify(payload));
    },
  };
}

export function officeBackend(): StorageBackend {
  return {
    getItem: (key) => OfficeRuntime.storage.getItem(key),
    setItem: (key, value) => OfficeRuntime.storage.setItem(key, value),
    removeItem: (key) => OfficeRuntime.storage.removeItem(key),
  };
}

/** Volatile heap map. Do not replace with localStorage / IndexedDB / files. */
export function inMemoryBackend(): StorageBackend {
  const store = new Map<string, string>();
  return {
    async getItem(key) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async setItem(key, value) {
      store.set(key, value);
    },
    async removeItem(key) {
      store.delete(key);
    },
  };
}

function isReasoningLevel(v: unknown): v is ReasoningLevel {
  return typeof v === "string" && (REASONING_LEVELS as readonly string[]).includes(v);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Coerce unknown JSON into a de-duped array of non-empty strings. */
function toStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of v) {
    if (typeof item === "string" && item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

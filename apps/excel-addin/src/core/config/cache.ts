import { officeBackend, type StorageBackend } from "../storage";
import type { RemoteConfig } from "./types";

const KEY_CONFIG = "excelente.config.cached";

/** 6 hours — the fallback when a config doesn't specify `refreshIntervalSec`. */
const DEFAULT_REFRESH_INTERVAL_SEC = 6 * 60 * 60;

export interface CachedConfig {
  config: RemoteConfig;
  etag: string;
  /** Epoch ms of the last successful fetch/revalidation. */
  fetchedAt: number;
}

export interface ConfigCache {
  read(): Promise<CachedConfig | null>;
  write(entry: CachedConfig): Promise<void>;
  clear(): Promise<void>;
}

export function createConfigCache(backend: StorageBackend = officeBackend()): ConfigCache {
  return {
    async read() {
      const raw = await backend.getItem(KEY_CONFIG);
      if (!raw) return null;
      try {
        return parseCached(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async write(entry) {
      await backend.setItem(KEY_CONFIG, JSON.stringify(entry));
    },
    async clear() {
      await backend.removeItem(KEY_CONFIG);
    },
  };
}

/** True when the cached entry is older than its refresh interval. */
export function isStale(entry: CachedConfig, now: number = Date.now()): boolean {
  const seconds =
    Number.isFinite(entry.config.refreshIntervalSec) && entry.config.refreshIntervalSec > 0
      ? entry.config.refreshIntervalSec
      : DEFAULT_REFRESH_INTERVAL_SEC;
  return now - entry.fetchedAt >= seconds * 1000;
}

/**
 * Whether `fetched` should replace `cached` based on the monotonic semantic
 * `version`. A higher version means derived state (tier mapping, managed MCP,
 * remote skills) must be re-resolved by the caller.
 */
export function isNewerVersion(cached: CachedConfig | null, fetched: RemoteConfig): boolean {
  if (!cached) return true;
  return fetched.version > cached.config.version;
}

function parseCached(value: unknown): CachedConfig | null {
  if (!isObject(value)) return null;
  const { config, etag, fetchedAt } = value;
  if (!isObject(config)) return null;
  if (typeof (config as { version?: unknown }).version !== "number") return null;
  if (typeof etag !== "string") return null;
  if (typeof fetchedAt !== "number" || !Number.isFinite(fetchedAt)) return null;
  return { config: config as unknown as RemoteConfig, etag, fetchedAt };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

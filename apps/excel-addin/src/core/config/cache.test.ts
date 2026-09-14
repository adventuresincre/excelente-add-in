import { describe, expect, it } from "vitest";
import { inMemoryBackend } from "../storage";
import { createConfigCache, isStale, isNewerVersion, type CachedConfig } from "./cache";
import { DEFAULT_PUBLIC_CONFIG } from "./defaults";
import type { RemoteConfig } from "./types";

function makeConfig(over: Partial<RemoteConfig> = {}): RemoteConfig {
  return {
    version: 1,
    etag: "etag-1",
    refreshIntervalSec: 6 * 60 * 60,
    public: DEFAULT_PUBLIC_CONFIG,
    ...over,
  };
}

function makeEntry(over: Partial<CachedConfig> = {}): CachedConfig {
  return {
    config: makeConfig(),
    etag: "etag-1",
    fetchedAt: Date.now(),
    ...over,
  };
}

describe("ConfigCache", () => {
  it("round-trips a cached config", async () => {
    const cache = createConfigCache(inMemoryBackend());
    expect(await cache.read()).toBeNull();
    const entry = makeEntry();
    await cache.write(entry);
    expect(await cache.read()).toEqual(entry);
  });

  it("clear() removes the cached config", async () => {
    const cache = createConfigCache(inMemoryBackend());
    await cache.write(makeEntry());
    await cache.clear();
    expect(await cache.read()).toBeNull();
  });

  it("returns null for corrupt JSON", async () => {
    const backend = inMemoryBackend();
    await backend.setItem("excelente.config.cached", "}{");
    expect(await createConfigCache(backend).read()).toBeNull();
  });

  it("returns null when the shape is invalid (missing version)", async () => {
    const backend = inMemoryBackend();
    await backend.setItem(
      "excelente.config.cached",
      JSON.stringify({ config: { etag: "x" }, etag: "x", fetchedAt: Date.now() })
    );
    expect(await createConfigCache(backend).read()).toBeNull();
  });
});

describe("isStale", () => {
  const base = makeEntry({ fetchedAt: 1_000_000 });

  it("is fresh within the refresh interval", () => {
    expect(isStale(base, base.fetchedAt + 60_000)).toBe(false);
  });

  it("is stale once the interval elapses", () => {
    const ms = base.config.refreshIntervalSec * 1000;
    expect(isStale(base, base.fetchedAt + ms + 1)).toBe(true);
  });

  it("falls back to a 6h interval when refreshIntervalSec is invalid", () => {
    const entry = makeEntry({
      config: makeConfig({ refreshIntervalSec: 0 }),
      fetchedAt: 1_000_000,
    });
    const sixHours = 6 * 60 * 60 * 1000;
    expect(isStale(entry, entry.fetchedAt + sixHours - 1)).toBe(false);
    expect(isStale(entry, entry.fetchedAt + sixHours + 1)).toBe(true);
  });
});

describe("isNewerVersion", () => {
  it("is true when there's no cache", () => {
    expect(isNewerVersion(null, makeConfig({ version: 1 }))).toBe(true);
  });
  it("is true when the fetched version is higher", () => {
    expect(isNewerVersion(makeEntry(), makeConfig({ version: 2 }))).toBe(true);
  });
  it("is false when the fetched version is the same or lower", () => {
    expect(isNewerVersion(makeEntry(), makeConfig({ version: 1 }))).toBe(false);
    expect(
      isNewerVersion(makeEntry({ config: makeConfig({ version: 5 }) }), makeConfig({ version: 4 }))
    ).toBe(false);
  });
});

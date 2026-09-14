import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetAcreFreeInfoCache, fetchAcreFreeInfo } from "./useAcreFreeInfo";

function stub(body: unknown, ok = true, status = 200) {
  const spy = vi.fn((_url: string) =>
    Promise.resolve({ ok, status, json: () => Promise.resolve(body) } as Response)
  );
  globalThis.fetch = spy as unknown as typeof fetch;
  return spy;
}

afterEach(() => {
  __resetAcreFreeInfoCache();
  vi.restoreAllMocks();
});

describe("fetchAcreFreeInfo", () => {
  it("prettifies the model id the proxy reports", async () => {
    stub({ model: "z-ai/glm-5.3-flash", ipMonthlyUsdCap: 10 });
    await expect(fetchAcreFreeInfo()).resolves.toEqual({
      modelLabel: "GLM 5.3 Flash",
      monthlyUsdCap: 10,
    });
  });

  // The env override exists for ids the prettifier renders badly, so it has
  // to win outright rather than merge.
  it("prefers an explicit modelLabel over the derived one", async () => {
    stub({ model: "z-ai/glm-5.3-flash", modelLabel: "GLM 5.3 Flash (Air)" });
    const info = await fetchAcreFreeInfo();
    expect(info.modelLabel).toBe("GLM 5.3 Flash (Air)");
  });

  it("ignores a blank modelLabel and falls back to the id", async () => {
    stub({ model: "openai/gpt-5-mini", modelLabel: "   " });
    const info = await fetchAcreFreeInfo();
    expect(info.modelLabel).toBe("GPT 5 Mini");
  });

  // A dead proxy must not produce a wrong label; callers render the bare
  // tier name off a null.
  it("resolves to an unknown label when the proxy fails", async () => {
    stub({}, false, 502);
    await expect(fetchAcreFreeInfo()).resolves.toEqual({
      modelLabel: null,
      monthlyUsdCap: null,
    });
  });

  it("resolves to an unknown label when fetch throws", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as never;
    const info = await fetchAcreFreeInfo();
    expect(info.modelLabel).toBeNull();
  });

  it("shares one request across concurrent callers", async () => {
    const spy = stub({ model: "z-ai/glm-5.3-flash" });
    await Promise.all([fetchAcreFreeInfo(), fetchAcreFreeInfo(), fetchAcreFreeInfo()]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  // A failure caches nothing, so opening Settings after the network comes
  // back shows the real model instead of the bare name for the session.
  it("retries after a failure instead of caching it", async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error("offline"))) as never;
    expect((await fetchAcreFreeInfo()).modelLabel).toBeNull();
    stub({ model: "z-ai/glm-5.3-flash" });
    expect((await fetchAcreFreeInfo()).modelLabel).toBe("GLM 5.3 Flash");
  });

  it("hits the proxy's health path", async () => {
    const spy = stub({ model: "z-ai/glm-5.3-flash" });
    await fetchAcreFreeInfo();
    expect(spy.mock.calls[0][0]).toBe("/api/free/health");
  });
});

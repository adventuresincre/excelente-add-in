import { afterEach, describe, expect, it, vi } from "vitest";
import { APP_VERSION, BUILD_ID, BUILD_SHA, buildDate, checkForUpdate } from "./version";

describe("build identity", () => {
  it("is substituted at build time, not left as a literal placeholder", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(BUILD_SHA).not.toBe("");
    expect(BUILD_ID).toBe(`${APP_VERSION}+${BUILD_SHA}`);
  });

  it("renders a YYYY-MM-DD build date", () => {
    expect(buildDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("checkForUpdate", () => {
  afterEach(() => vi.unstubAllGlobals());

  const respond = (body: unknown, ok = true): void => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok, json: async () => body } as unknown as Response)
    );
  };

  it("reports stale when the deployed build id differs", async () => {
    respond({ version: "9.9.9", sha: "deadbee", buildTime: "", buildId: "9.9.9+deadbee" });
    const r = await checkForUpdate();
    expect(r?.stale).toBe(true);
    expect(r?.deployed.buildId).toBe("9.9.9+deadbee");
  });

  it("reports not-stale when the deployed build id matches", async () => {
    respond({ version: APP_VERSION, sha: BUILD_SHA, buildTime: "", buildId: BUILD_ID });
    const r = await checkForUpdate();
    expect(r?.stale).toBe(false);
  });

  it("cache-busts the request — asking the cache if the cache is stale is useless", async () => {
    respond({ buildId: BUILD_ID });
    await checkForUpdate();
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toMatch(/^\/version\.json\?t=\d+$/);
    expect((init as RequestInit).cache).toBe("no-store");
  });

  // A failed check must never render as "update available" — that would send
  // someone chasing a reload that changes nothing.
  it("returns null when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns null on a non-200 (dev server with no version.json)", async () => {
    respond({}, false);
    expect(await checkForUpdate()).toBeNull();
  });

  it("returns null when the payload has no buildId", async () => {
    respond({ version: "0.0.0" });
    expect(await checkForUpdate()).toBeNull();
  });
});

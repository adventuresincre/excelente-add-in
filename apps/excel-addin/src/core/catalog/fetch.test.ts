import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchModelCatalog,
  MODEL_CATALOG_ENDPOINT,
  parseModelCatalog,
  resetModelCatalogCache,
} from "./fetch";

const GOOD = {
  schemaVersion: 1,
  generatedAt: "2026-09-11T04:31:07.000Z",
  source: {
    name: "Artificial Analysis",
    url: "https://artificialanalysis.ai",
    indexVersion: "4.3",
  },
  models: {
    "openai/gpt-6-astra": {
      capability: 53,
      capabilityByEffort: { max: 53 },
      releaseDate: "2026-06-12",
    },
    "bad/entry": { capability: "fifty" },
    "worse/entry": null,
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("parseModelCatalog", () => {
  it("keeps well-formed entries and drops malformed ones individually", () => {
    const parsed = parseModelCatalog(GOOD);
    expect(parsed?.source.indexVersion).toBe("4.3");
    expect(Object.keys(parsed?.models ?? {})).toEqual(["openai/gpt-6-astra"]);
    expect(parsed?.models["openai/gpt-6-astra"]).toEqual({
      capability: 53,
      capabilityByEffort: { max: 53 },
      releaseDate: "2026-06-12",
    });
  });

  it("rejects any other schema version or a missing models map", () => {
    expect(parseModelCatalog({ ...GOOD, schemaVersion: 2 })).toBeNull();
    expect(parseModelCatalog({ schemaVersion: 1 })).toBeNull();
    expect(parseModelCatalog("nope")).toBeNull();
  });
});

describe("fetchModelCatalog", () => {
  beforeEach(() => resetModelCatalogCache());

  it("fetches the same-origin file once per session", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(GOOD));
    const a = await fetchModelCatalog({ fetchImpl });
    const b = await fetchModelCatalog({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe(MODEL_CATALOG_ENDPOINT);
    expect(a?.models["openai/gpt-6-astra"]?.capability).toBe(53);
    expect(b).toBe(a);
  });

  // A missing file is the normal state of a fresh instance; the picker has
  // to keep working without scores, and a later mount should try again.
  it("resolves null on failure and does not cache the failure", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "nope" }, 404))
      .mockResolvedValueOnce(jsonResponse(GOOD));
    expect(await fetchModelCatalog({ fetchImpl })).toBeNull();
    expect((await fetchModelCatalog({ fetchImpl }))?.models["openai/gpt-6-astra"]?.capability).toBe(
      53
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("treats an unrecognised shape like a failure", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ schemaVersion: 9 }));
    expect(await fetchModelCatalog({ fetchImpl })).toBeNull();
  });

  it("refetches when forced", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(GOOD));
    await fetchModelCatalog({ fetchImpl });
    await fetchModelCatalog({ fetchImpl, force: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

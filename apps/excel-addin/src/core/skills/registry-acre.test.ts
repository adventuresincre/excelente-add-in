import { describe, expect, it, vi } from "vitest";
import { acreSkillSource, ACRE_SOURCE_ID } from "./registry-acre";
import type { AcreSkillEntry } from "../config";

const SKILL_MD = `---
name: apartment-acquisition-model
description: Underwrite a multifamily acquisition
version: 2.5.0
---
Follow these steps to underwrite the deal.`;

const RESOURCE_MD = `# Cap rate ranges\n- Class A: 4.5-5.5%`;

function entry(over: Partial<AcreSkillEntry> = {}): AcreSkillEntry {
  return {
    name: "apartment-acquisition-model",
    description: "Underwrite a multifamily acquisition",
    version: "2.5.0",
    acceleratorOnly: false,
    bodyUrl: "https://hub.example/skills/apartment/SKILL.md",
    ...over,
  };
}

describe("acreSkillSource.list", () => {
  it("maps config summaries and tags the source id", async () => {
    const src = acreSkillSource({
      skills: [entry({ whenToUse: "When acquiring apartments" })],
      accelerator: false,
      getToken: () => "tok",
      fetch: vi.fn(),
    });
    expect(await src.list()).toEqual([
      {
        name: "apartment-acquisition-model",
        description: "Underwrite a multifamily acquisition",
        whenToUse: "When acquiring apartments",
        version: "2.5.0",
        sourceId: ACRE_SOURCE_ID,
      },
    ]);
  });

  it("hides Accelerator-only skills from non-Accelerator members", async () => {
    const src = acreSkillSource({
      skills: [
        entry({ name: "free-skill", bodyUrl: "u1" }),
        entry({ name: "gated-skill", bodyUrl: "u2", acceleratorOnly: true }),
      ],
      accelerator: false,
      getToken: () => "tok",
      fetch: vi.fn(),
    });
    const names = (await src.list()).map((s) => s.name);
    expect(names).toEqual(["free-skill"]);
  });

  it("includes Accelerator-only skills for Accelerator members", async () => {
    const src = acreSkillSource({
      skills: [
        entry({ name: "free-skill", bodyUrl: "u1" }),
        entry({ name: "gated-skill", bodyUrl: "u2", acceleratorOnly: true }),
      ],
      accelerator: true,
      getToken: () => "tok",
      fetch: vi.fn(),
    });
    const names = (await src.list()).map((s) => s.name);
    expect(names).toEqual(["free-skill", "gated-skill"]);
  });
});

describe("acreSkillSource.load", () => {
  it("fetches the body with the member token and parses frontmatter + body", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(SKILL_MD, { status: 200 }));
    const src = acreSkillSource({
      skills: [entry()],
      accelerator: false,
      getToken: () => "member-tok",
      fetch,
    });

    const skill = await src.load("apartment-acquisition-model");
    expect(fetch).toHaveBeenCalledWith(entry().bodyUrl, {
      headers: { Authorization: "Bearer member-tok" },
    });
    expect(skill.summary).toMatchObject({
      name: "apartment-acquisition-model",
      version: "2.5.0",
      sourceId: ACRE_SOURCE_ID,
    });
    expect(skill.body).toBe("Follow these steps to underwrite the deal.");
    expect(skill.resources.size).toBe(0);
  });

  it("loads manifest resources alongside the body", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(SKILL_MD, { status: 200 }))
      .mockResolvedValueOnce(new Response(RESOURCE_MD, { status: 200 }));
    const src = acreSkillSource({
      skills: [
        entry({
          resourceManifest: [
            { path: "references/cap-rates.md", url: "https://hub.example/r/cap-rates.md" },
          ],
        }),
      ],
      accelerator: false,
      getToken: () => "tok",
      fetch,
    });

    const skill = await src.load("apartment-acquisition-model");
    expect(skill.resources.get("references/cap-rates.md")).toBe(RESOURCE_MD);
  });

  it("throws when the skill isn't available (unknown or gated)", async () => {
    const src = acreSkillSource({
      skills: [entry({ name: "gated", acceleratorOnly: true })],
      accelerator: false,
      getToken: () => "tok",
      fetch: vi.fn(),
    });
    await expect(src.load("gated")).rejects.toThrow(/not available/);
    await expect(src.load("nonexistent")).rejects.toThrow(/not available/);
  });

  it("throws when the body fetch fails", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 403 }));
    const src = acreSkillSource({
      skills: [entry()],
      accelerator: false,
      getToken: () => "tok",
      fetch,
    });
    await expect(src.load("apartment-acquisition-model")).rejects.toThrow(/403/);
  });
});

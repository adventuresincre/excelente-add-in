import type { ToolDef } from "./types";

interface ReadSkillResourceInput {
  skill: string;
  path: string;
}

/**
 * Per the Open Agent Skills spec (https://agentskills.io), a skill can ship
 * reference files that the agent loads on demand — "progressive disclosure".
 * The skill's SKILL.md tells the agent which files exist; this tool fetches
 * one when needed.
 */
export const readSkillResourceTool: ToolDef<ReadSkillResourceInput, string> = {
  name: "read_skill_resource",
  description:
    "Read a reference file bundled with a skill. Use only when a loaded skill's body mentions " +
    "the reference and you need it — don't read speculatively. A wrong path errors with the " +
    "list of available paths.",
  inputSchema: {
    type: "object",
    properties: {
      skill: {
        type: "string",
        description: 'Name of an active / installed skill, e.g. "direct-cap-valuation".',
      },
      path: {
        type: "string",
        description:
          'Resource path relative to the skill folder, e.g. "references/cap-rate-ranges.md".',
      },
    },
    required: ["skill", "path"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ skill, path }, { skillRegistry }) {
    if (!skillRegistry) {
      throw new Error("read_skill_resource: skill registry not available in this context.");
    }
    const loaded = await skillRegistry.load(skill);
    const content = loaded.resources.get(path);
    if (content !== undefined) return content;

    const available = Array.from(loaded.resources.keys()).sort();
    const list = available.length > 0 ? available.join(", ") : "(none)";
    throw new Error(`Resource not found in skill "${skill}": "${path}". Available paths: ${list}`);
  },
};

interface FindSkillInput {
  query: string;
  limit?: number;
}

interface FindSkillMatch {
  name: string;
  description: string;
  whenToUse?: string;
}

interface FindSkillResult {
  matches: FindSkillMatch[];
}

/**
 * Discovery half of the find_skill / load_skill pair. The agent calls this
 * when a task looks like it might warrant a specialist playbook; the result is
 * a ranked list of installed-skill names + descriptions ONLY (no bodies).
 * Bodies are pulled on demand via `load_skill`. This keeps the system prompt
 * constant-size regardless of how many skills are installed.
 */
export const findSkillTool: ToolDef<FindSkillInput, FindSkillResult> = {
  name: "find_skill",
  description:
    "Search installed skills for the user's task. Call whenever the task looks specialized " +
    "(valuation, modeling, audit, cleanup, scenarios) and you don't already know which skill " +
    "applies. Returns ranked { name, description, whenToUse } — no bodies; load_skill pulls " +
    "the one you pick. Empty matches → proceed without one.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Short phrase capturing the user\'s ask, e.g. "build a DCF with sensitivities".',
      },
      limit: {
        type: "number",
        description: "Max number of matches to return. Defaults to 5.",
        minimum: 1,
        maximum: 20,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ query, limit }, { skillRegistry }) {
    if (!skillRegistry) {
      throw new Error("find_skill: skill registry not available in this context.");
    }
    const matches = await skillRegistry.match(query, limit ?? 5);
    return {
      matches: matches.map((s) => ({
        name: s.name,
        description: s.description,
        whenToUse: s.whenToUse,
      })),
    };
  },
};

interface LoadSkillInput {
  name: string;
}

interface LoadSkillResult {
  name: string;
  description: string;
  whenToUse?: string;
  /** Full markdown playbook from SKILL.md (the skill body). */
  body: string;
  /**
   * Paths of bundled reference files the skill ships. Fetch one with
   * `read_skill_resource` when the body references it.
   */
  resources: string[];
}

/**
 * Load half of the find_skill / load_skill pair. Returns the full skill body
 * (the markdown playbook) plus the list of bundled resource paths. The agent
 * should call this once it's picked a skill from `find_skill` results — or
 * when it already knows the skill name from earlier in the conversation.
 */
export const loadSkillTool: ToolDef<LoadSkillInput, LoadSkillResult> = {
  name: "load_skill",
  description:
    "Load a skill's full markdown playbook plus its reference-file paths. Call once you've " +
    "picked a skill (usually from find_skill results) — BEFORE designing your approach.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: 'Skill name from `find_skill` results, e.g. "direct-cap-valuation".',
      },
    },
    required: ["name"],
    additionalProperties: false,
  },
  requiredPermission: "Read",
  async execute({ name }, { skillRegistry }) {
    if (!skillRegistry) {
      throw new Error("load_skill: skill registry not available in this context.");
    }
    const skill = await skillRegistry.load(name);
    return {
      name: skill.summary.name,
      description: skill.summary.description,
      whenToUse: skill.summary.whenToUse,
      body: skill.body,
      resources: Array.from(skill.resources.keys()).sort(),
    };
  },
};

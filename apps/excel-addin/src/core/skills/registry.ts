import type { Skill, SkillSource, SkillSummary } from "./types";

export interface SkillRegistry {
  /** All known skills across sources, frontmatter-only. */
  list(): Promise<SkillSummary[]>;
  /** Look up one skill's summary by name. */
  findByName(name: string): Promise<SkillSummary | null>;
  /** Load the full skill (frontmatter + body + reference loader). */
  load(name: string): Promise<Skill>;
  /**
   * Rank skills by relevance to `userMessage`. Uses BM25 over the
   * concatenation of `whenToUse` (3x weight), `description` (2x), and `name`
   * (1x) — the standard BM25F-lite field-weighting trick. Returns at most
   * `limit` matches with score > 0.
   */
  match(userMessage: string, limit?: number): Promise<SkillSummary[]>;
}

export function createSkillRegistry(sources: SkillSource[]): SkillRegistry {
  return {
    async list() {
      // Isolate sources: a dead IndexedDB-backed user store must not take
      // down bundled skills that never touch IDB.
      const settled = await Promise.allSettled(sources.map((s) => s.list()));
      const out: SkillSummary[] = [];
      for (const result of settled) {
        if (result.status === "fulfilled") out.push(...result.value);
      }
      return out;
    },
    async findByName(name) {
      const all = await this.list();
      return all.find((s) => s.name === name) ?? null;
    },
    async load(name) {
      for (const source of sources) {
        let listed: SkillSummary[];
        try {
          listed = await source.list();
        } catch {
          continue;
        }
        if (listed.some((s) => s.name === name)) {
          return source.load(name);
        }
      }
      throw new Error(`Skill not found: ${name}`);
    },
    async match(userMessage, limit = 5) {
      const queryTokens = tokensOf(userMessage);
      if (queryTokens.length === 0) return [];

      const all = await this.list();
      if (all.length === 0) return [];

      const docs = all.map((skill) => ({ skill, tokens: buildDocument(skill) }));
      const avgDl = docs.reduce((sum, d) => sum + d.tokens.length, 0) / Math.max(docs.length, 1);

      const docFreq = new Map<string, number>();
      for (const { tokens } of docs) {
        const seen = new Set(tokens);
        for (const t of seen) docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
      const N = docs.length;

      return docs
        .map(({ skill, tokens }) => ({
          skill,
          score: bm25Score(queryTokens, tokens, N, docFreq, avgDl),
        }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((entry) => entry.skill);
    },
  };
}

/* ------------------------------ BM25 internals ---------------------------- */

// Standard BM25 tuning. k1 controls term-frequency saturation; b controls
// length normalization. These are the textbook defaults.
const K1 = 1.5;
const B = 0.75;

// Field weights, applied via repetition (BM25F-lite). Three hits on
// `whenToUse` is the strongest signal that this skill was authored for a
// query like the user's; name matches are weakest because they're often
// generic ("formula", "audit").
const FIELD_WEIGHT_WHEN_TO_USE = 3;
const FIELD_WEIGHT_DESCRIPTION = 2;
const FIELD_WEIGHT_NAME = 1;

function buildDocument(skill: SkillSummary): string[] {
  const tokens: string[] = [];
  if (skill.whenToUse) {
    const when = tokensOf(skill.whenToUse);
    for (let i = 0; i < FIELD_WEIGHT_WHEN_TO_USE; i++) tokens.push(...when);
  }
  const desc = tokensOf(skill.description);
  for (let i = 0; i < FIELD_WEIGHT_DESCRIPTION; i++) tokens.push(...desc);
  const name = tokensOf(skill.name);
  for (let i = 0; i < FIELD_WEIGHT_NAME; i++) tokens.push(...name);
  return tokens;
}

function bm25Score(
  queryTokens: string[],
  docTokens: string[],
  N: number,
  docFreq: Map<string, number>,
  avgDl: number
): number {
  if (docTokens.length === 0 || avgDl === 0) return 0;

  const tf = new Map<string, number>();
  for (const t of docTokens) tf.set(t, (tf.get(t) ?? 0) + 1);

  let score = 0;
  for (const q of queryTokens) {
    const n = docFreq.get(q) ?? 0;
    if (n === 0) continue;
    const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const numerator = f * (K1 + 1);
    const denominator = f + K1 * (1 - B + (B * docTokens.length) / avgDl);
    score += idf * (numerator / denominator);
  }
  return score;
}

function tokensOf(text: string): string[] {
  const tokens: string[] = [];
  for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= 3 && !STOPWORDS.has(word)) tokens.push(word);
  }
  return tokens;
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "this",
  "that",
  "are",
  "was",
  "but",
  "have",
  "has",
  "had",
  "you",
  "your",
  "yours",
  "from",
  "into",
  "what",
  "where",
  "when",
  "why",
  "how",
  "can",
  "will",
  "would",
  "should",
  "could",
  "want",
  "need",
  "please",
]);

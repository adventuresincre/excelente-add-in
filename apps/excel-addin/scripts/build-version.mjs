/**
 * Emit dist/version.json — the deployed build's identity.
 *
 * This is what makes "am I running the latest?" answerable. The pane fetches
 * it and compares against its own baked-in build id; a mismatch means Office
 * is serving a cached bundle. It is also curl-able, so a deploy can be
 * verified from outside Excel:
 *
 *     curl -s https://excelente.aiedge.ac/version.json
 *
 * Must run AFTER `vite build` (dist/ is emptied by it) and must derive its
 * values the same way vite.config.ts does, or the pane would compare against
 * a number that never matches. That includes the timestamp: it is the COMMIT
 * time, not the wall clock, so building one sha twice is byte-identical.
 *
 * `env` marks which instance this artifact was deployed to. It lives here
 * rather than in the bundle on purpose — the bundle must stay identical
 * between dev and production so the thing you tested is provably the thing
 * you promote. The pane reads this file at runtime to decide whether to
 * show the DEV badge.
 */
import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

const envIdx = process.argv.indexOf("--env");
const env = envIdx !== -1 ? process.argv[envIdx + 1] : "prod";
if (!["dev", "prod"].includes(env)) {
  console.error(`build-version: --env must be "dev" or "prod", got "${env}"`);
  process.exit(1);
}

let sha = "unknown";
let buildTime = new Date().toISOString();
try {
  sha = execSync("git rev-parse --short HEAD", { encoding: "utf8", cwd: root }).trim();
  buildTime = execSync("git show -s --format=%cI HEAD", { encoding: "utf8", cwd: root }).trim();
  if (execSync("git status --porcelain", { encoding: "utf8", cwd: root }).trim()) {
    sha += "-dirty";
  }
} catch {
  // No git available — semver alone still identifies the release.
}

const payload = {
  version: pkg.version,
  sha,
  env,
  buildTime,
  buildId: `${pkg.version}+${sha}`,
};

const out = resolve(root, "dist", "version.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(payload, null, 2) + "\n", "utf8");
console.log(`  dist/version.json  ${payload.buildId}  [${env}]`);

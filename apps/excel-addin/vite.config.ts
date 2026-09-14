/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { getHttpsServerOptions } from "office-addin-dev-certs";
import { resolve } from "path";
import { execSync } from "child_process";
import { readFileSync } from "fs";

/**
 * Build identity, resolved once per build.
 *
 * Three version identities exist in this project and they are deliberately
 * NOT the same number:
 *
 *   1. package.json `version` — the product's semver. Hand-bumped.
 *   2. This build id (git short SHA) — which commit is actually running.
 *   3. manifest.template.xml <Version> — Office/AppSource's 4-part version.
 *      Bumped ONLY for a Partner Center submission, because the deployed
 *      manifest's SHA256 is tracked against the submitted one; a file-only
 *      deploy must leave it byte-identical.
 *
 * Only #1 and #2 reach the UI. Without them there is no way to tell a stale
 * cached pane from a fresh one — the asset hash is in the filename, but
 * nobody can read a filename from inside Excel.
 *
 * DETERMINISM: every value here must be a pure function of the commit, so
 * that building the same sha twice produces byte-identical output. That is
 * what lets us prove dev and production are serving the same code rather
 * than merely asserting it — and what makes "promote the artifact you
 * tested" a checkable claim instead of a process rule. `__BUILD_TIME__` is
 * therefore the COMMIT timestamp, not the wall clock at build time.
 */
function buildIdentity(): { version: string; sha: string; time: string } {
  const pkg = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as {
    version: string;
  };
  let sha = "unknown";
  // Wall clock only as a last resort; a non-deterministic value here would
  // make two builds of one commit differ and defeat the identity check.
  let time = new Date().toISOString();
  try {
    sha = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
    time = execSync("git show -s --format=%cI HEAD", { encoding: "utf8" }).trim();
    // A deploy built from uncommitted work is a real and common state —
    // say so rather than reporting a commit that does not contain it.
    const dirty = execSync("git status --porcelain", { encoding: "utf8" }).trim();
    if (dirty) sha += "-dirty";
  } catch {
    // No git (CI tarball, published source drop) — the semver still applies.
  }
  return { version: pkg.version, sha, time };
}

export default defineConfig(async ({ command }) => {
  const isServe = command === "serve";
  const https = isServe ? await getHttpsServerOptions() : undefined;

  const build = buildIdentity();

  // Optional dev-only proxy target. See the `proxy` block below.
  const devProxyTarget = (process.env.EXCELENTE_DEV_PROXY_TARGET ?? "").replace(/\/+$/, "");

  return {
    define: {
      __APP_VERSION__: JSON.stringify(build.version),
      __BUILD_SHA__: JSON.stringify(build.sha),
      __BUILD_TIME__: JSON.stringify(build.time),
    },
    plugins: [react()],
    server: {
      port: 3000,
      // Excel sideloads the manifest against https://localhost:3000. If Vite
      // can't get that exact port (because a previous Node process left
      // sitting on it), silently moving to 3001 puts the user in a state
      // where everything looks fine but Excel is talking to STALE code on
      // 3000 — confusing "why aren't my changes showing up?" for half an
      // hour. Fail loudly so the error message tells them to kill the
      // stale process.
      strictPort: true,
      https: https && { key: https.key, cert: https.cert, ca: https.ca },
      headers: { "Access-Control-Allow-Origin": "*" },
      // Two paths that a deployed instance serves through its own web server
      // and that a local dev server has no way to answer:
      //
      //   /api/free  a hosted proxy that holds the OpenRouter key server-side
      //              and meters spend, so the pane can run with no key of its
      //              own. Optional. Without it, add your own OpenRouter key in
      //              Settings and everything works.
      //   /data      a periodically rebuilt model capability catalog, read as
      //              a static JSON file. Optional; the catalog loader returns
      //              null when it is missing and the pane carries on.
      //
      // Set EXCELENTE_DEV_PROXY_TARGET to the origin of an instance you
      // control to forward both during `npm run dev`. Unset (the default) is
      // the right answer for most contributors: nothing is proxied, and the
      // add-in runs entirely on your own OpenRouter key. Do not point this at
      // an instance you do not own.
      proxy: devProxyTarget
        ? {
            "/api/free": {
              target: devProxyTarget,
              changeOrigin: true,
              headers: { Origin: devProxyTarget },
            },
            "/data": { target: devProxyTarget, changeOrigin: true },
          }
        : undefined,
    },
    preview: {
      port: 3000,
      strictPort: true,
      https: https && { key: https.key, cert: https.cert, ca: https.ca },
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      sourcemap: true,
      rollupOptions: {
        input: {
          taskpane: resolve(__dirname, "taskpane.html"),
          commands: resolve(__dirname, "commands.html"),
          // OAuth dialog start/redirect page (core/mcp/office-dialog.ts).
          authCallback: resolve(__dirname, "auth-callback.html"),
        },
      },
    },
    test: {
      include: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "server/**/*.test.mjs",
      ],
      environment: "node",
    },
  };
});

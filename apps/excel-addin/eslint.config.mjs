import officeAddins from "eslint-plugin-office-addins";
import tsParser from "@typescript-eslint/parser";
import globals from "globals";

/**
 * Project lint config.
 *
 * `office-addin-lint` resolves `eslint.config.mjs` from the project root and
 * silently falls back to its own bundled config when that file is absent.
 * The repo previously carried only a legacy `.eslintrc.json`, which ESLint 9
 * does not read in flat-config mode — so that file was inert and every run
 * used Microsoft's defaults with no browser or Office globals declared. The
 * result was ~258 phantom `no-undef` errors for `Office`, `Excel`, `fetch`,
 * `File`, `Response`, and friends, which buried the ~30 real findings and
 * made `npm run lint` useless as a gate. This file replaces it.
 */
export default [
  ...officeAddins.configs.recommended,
  {
    plugins: {
      "office-addins": officeAddins,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        // Office.js host globals, injected by the Office runtime.
        Office: "readonly",
        Excel: "readonly",
        OfficeRuntime: "readonly",
      },
    },
    rules: {
      // TypeScript resolves identifiers itself and `npm run typecheck` is the
      // project's stated correctness gate, so ESLint's own undefined-variable
      // check is redundant here and produces false positives on type-only and
      // ambient declarations. This mirrors typescript-eslint's own guidance.
      "no-undef": "off",
      // Honor the leading-underscore convention for deliberately-unused
      // bindings, so a parameter kept to document a signature (or a caught
      // error we intentionally swallow) doesn't have to be deleted to pass.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Build tooling runs in Node, not the browser.
    files: ["scripts/**/*.mjs", "vite.config.ts"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    /**
     * `datasource.ts` is the one module that talks to raw Office.js (per
     * CLAUDE.md, `Excel.run` is confined to `core/context` and
     * `core/tools/excel`). Every call there already follows the required
     * load → `await ctx.sync()` → read order, but the plugin's sync analysis
     * cannot follow `await ctx.sync()` across the `Excel.run(async (ctx) =>
     * …)` callback boundary, so it reports all 28 of them as violations.
     * Each flagged line was inspected individually and is correct.
     *
     * Scoped to this file rather than disabled repo-wide: the rules catch a
     * genuine Office.js footgun, and any future module that reaches for raw
     * Office.js should still be checked by them.
     */
    files: ["src/core/context/datasource.ts"],
    rules: {
      "office-addins/call-sync-after-load": "off",
      "office-addins/call-sync-before-read": "off",
      "office-addins/load-object-before-read": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "*.config.mjs"],
  },
];

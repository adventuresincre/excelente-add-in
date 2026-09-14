/**
 * Compile-time constants substituted by `define` in vite.config.ts.
 * Declared here so `src/core/version.ts` type-checks without a runtime import.
 */
declare const __APP_VERSION__: string;
declare const __BUILD_SHA__: string;
declare const __BUILD_TIME__: string;

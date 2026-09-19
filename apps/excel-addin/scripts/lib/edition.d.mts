export const ADDIN_ROOT: string;
export const EDITIONS_DIR: string;
export const DEFAULT_EDITION: string;
export const EDITION_FILE: string;
export function listEditions(): string[];
export function readEditionFile(): { edition?: string; devProxyTarget?: string };
export function resolveEdition(env?: NodeJS.ProcessEnv): string;
export function editionDir(name: string): string;
export function devProxyTarget(env?: NodeJS.ProcessEnv): string;

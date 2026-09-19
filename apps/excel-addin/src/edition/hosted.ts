import type { HostedModel } from "./types";

/**
 * Lookups over an edition's hosted models. Shared code calls these with
 * `edition.hostedModels` (from `@edition`) so the same code runs in every
 * edition and does nothing when the list is empty.
 */

export function hostedModelFor(
  hosted: readonly HostedModel[],
  id: string | null | undefined
): HostedModel | null {
  if (!id) return null;
  return hosted.find((h) => h.id === id) ?? null;
}

export function isHostedModelId(
  hosted: readonly HostedModel[],
  id: string | null | undefined
): boolean {
  return hostedModelFor(hosted, id) !== null;
}

/**
 * Map a stored model id to the OpenRouter id it stands for. A hosted
 * sentinel becomes the host's upstream pin; anything else is returned as-is.
 */
export function resolveUpstreamModelId(hosted: readonly HostedModel[], id: string): string {
  return hostedModelFor(hosted, id)?.upstreamModelId ?? id;
}

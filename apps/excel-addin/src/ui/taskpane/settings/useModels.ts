import { useEffect, useState } from "react";
import type { ModelInfo, OpenRouterClient } from "../../../core/openrouter";
import { enrichModels, fetchModelCatalog } from "../../../core/catalog";

export interface UseModelsResult {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches the OpenRouter model list once the API key is known and merges in
 * the nightly capability catalog. Returns empty list + null error when apiKey
 * is null.
 *
 * The two fetches run in parallel and only the OpenRouter one can fail the
 * hook: the catalog resolves null when unavailable and the list then simply
 * carries no scores. A picker that went blank because a benchmark file was
 * missing would be the wrong trade.
 */
export function useModels(client: OpenRouterClient, apiKey: string | null): UseModelsResult {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!apiKey) {
      setModels([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const force = tick > 0;
    Promise.all([client.listModels(apiKey, { force }), fetchModelCatalog({ force })])
      .then(([list, catalog]) => {
        if (cancelled) return;
        setModels(enrichModels(list, catalog));
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setModels([]);
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, apiKey, tick]);

  return { models, loading, error, refresh: () => setTick((n) => n + 1) };
}

/**
 * Turns an OpenRouter error envelope into a sentence a user can act on.
 *
 * Errors used to surface as `OpenRouter 404: {"error":{"message":"0 endpoi…`
 * — truncated at 200 characters, which is exactly where OpenRouter starts
 * explaining itself. The envelope carries a `metadata` block with the reason
 * AND, in several cases, the URL that fixes it:
 *
 *   404  metadata.ineligibility_reasons[].configure_url
 *          → a workspace guardrail removed every endpoint
 *   429  metadata.raw / metadata.remedy_hint / metadata.provider_name
 *          → upstream shared-pool rate limit, with the remedy
 *   403  "only available on agentic harnesses"
 *          → provider restricts the model to apps in OpenRouter's directory
 *
 * Throwing that away turned a one-click fix into a dead end. Nothing here is
 * model-specific or hand-maintained: any future refusal that ships a
 * `configure_url` or a `remedy_hint` explains itself the same way.
 */
export interface ParsedOpenRouterError {
  /** Provider/OpenRouter text, untruncated. */
  message: string;
  /** First actionable URL found in the metadata, if any. */
  fixUrl?: string;
  /** Upstream provider name, when the failure came from one. */
  provider?: string;
}

export function parseOpenRouterError(responseBody: string): ParsedOpenRouterError | null {
  let error: Record<string, unknown>;
  try {
    const parsed = JSON.parse(responseBody) as { error?: unknown };
    if (typeof parsed.error === "string") return { message: parsed.error };
    if (!isRecord(parsed.error)) return null;
    error = parsed.error;
  } catch {
    return null;
  }

  const meta = isRecord(error.metadata) ? error.metadata : undefined;
  // `metadata.raw` is the upstream provider's own text and is consistently
  // more specific than the generic wrapper ("Provider returned error").
  const raw = typeof meta?.raw === "string" ? meta.raw.trim() : "";
  const outer = typeof error.message === "string" ? error.message.trim() : "";
  const message = raw || outer;
  if (!message) return null;

  return {
    message,
    fixUrl: firstUrl(meta),
    provider: typeof meta?.provider_name === "string" ? meta.provider_name : undefined,
  };
}

/**
 * The whole message, ready to render. Kept as one string because that is
 * what `Error.message` and the chat's error row already carry; the URL is
 * appended in full so it survives being copied out of a screenshot.
 */
export function describeOpenRouterError(status: number, responseBody: string): string {
  const parsed = parseOpenRouterError(responseBody);
  if (!parsed) {
    // Not our envelope — an HTML error page from nginx or a proxy. Keep the
    // old shape rather than inventing detail we don't have.
    return `OpenRouter ${status}: ${truncate(responseBody, 200)}`;
  }
  const parts = [parsed.provider ? `${parsed.provider}: ${parsed.message}` : parsed.message];
  if (parsed.fixUrl) parts.push(`Fix this at ${parsed.fixUrl}`);
  return parts.join(" ");
}

/**
 * `remedy_hint` and `configure_url` are the two documented carriers, but a
 * reason can also be nested one level down inside `ineligibility_reasons`.
 * Scan for the first http(s) URL in any of them rather than hard-coding a
 * path that upstream can reshape.
 */
function firstUrl(meta: Record<string, unknown> | undefined): string | undefined {
  if (!meta) return undefined;
  for (const key of ["configure_url", "remedy_hint", "ineligibility_reasons"]) {
    const found = scanForUrl(meta[key]);
    if (found) return found;
  }
  return scanForUrl(meta);
}

function scanForUrl(value: unknown, depth = 0): string | undefined {
  if (depth > 4) return undefined;
  if (typeof value === "string") {
    const m = /https?:\/\/[^\s"')]+/.exec(value);
    return m ? m[0].replace(/[.,;]+$/, "") : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = scanForUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (isRecord(value)) {
    for (const item of Object.values(value)) {
      const found = scanForUrl(item, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

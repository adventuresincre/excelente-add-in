import { describe, expect, it } from "vitest";
import { describeOpenRouterError, parseOpenRouterError } from "./error-message";

// Verbatim bodies captured from OpenRouter on 2026-09-10.
const GUARDRAIL = JSON.stringify({
  error: {
    message:
      "0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons):\nFree model training violation (guardrail): 1 endpoint excluded; configurable at https://openrouter.ai/workspaces/acre-agents/guardrails",
    code: 404,
    metadata: {
      input_endpoint_count: 1,
      ineligibility_reasons: [
        {
          reason: "free-model-training-violation-by-guardrail",
          endpoint_count: 1,
          configure_url: "https://openrouter.ai/workspaces/acre-agents/guardrails",
        },
      ],
      failed_routing_step: "Filter by Guardrails",
    },
  },
});

const RATE_LIMIT = JSON.stringify({
  error: {
    message: "Provider returned error",
    code: 429,
    metadata: {
      raw: "google/gemma-4-31b-it:free is temporarily rate-limited upstream. Please retry shortly, or add your own key to accumulate your rate limits: https://openrouter.ai/settings/integrations",
      provider_name: "Google AI Studio",
      provider_error_code: "429",
      limit_source: "upstream_provider_shared_pool",
    },
  },
});

const MID_STREAM = JSON.stringify({
  error: {
    message:
      "Upstream error from Nvidia: ResourceExhausted: Worker local total request limit reached (16/16)",
    code: 429,
  },
});

describe("describeOpenRouterError", () => {
  // The old output truncated at 200 chars, cutting the message off at
  // exactly the point OpenRouter starts naming the reason and the fix.
  it("keeps the fix URL from a guardrail rejection", () => {
    const msg = describeOpenRouterError(404, GUARDRAIL);
    expect(msg).toContain("0 endpoints out of 1 requested");
    expect(msg).toContain("https://openrouter.ai/workspaces/acre-agents/guardrails");
    expect(msg).not.toContain("…");
  });

  // `metadata.raw` is the provider's own text; the outer message is the
  // useless generic wrapper.
  it("prefers the provider's text over 'Provider returned error'", () => {
    const msg = describeOpenRouterError(429, RATE_LIMIT);
    expect(msg).toContain("Google AI Studio");
    expect(msg).toContain("temporarily rate-limited upstream");
    expect(msg).not.toMatch(/^Provider returned error/);
    expect(msg).toContain("https://openrouter.ai/settings/integrations");
  });

  it("handles an envelope with no metadata", () => {
    const msg = describeOpenRouterError(429, MID_STREAM);
    expect(msg).toContain("ResourceExhausted");
    expect(msg).toContain("16/16");
  });

  // An HTML error page from nginx or a proxy is not our envelope; inventing
  // structure for it would be worse than the old shape.
  it("falls back to the old shape for a non-JSON body", () => {
    expect(describeOpenRouterError(502, "<html>Bad Gateway</html>")).toBe(
      "OpenRouter 502: <html>Bad Gateway</html>"
    );
  });

  it("handles a string error field", () => {
    expect(describeOpenRouterError(400, '{"error":"bad request"}')).toBe("bad request");
  });
});

describe("parseOpenRouterError", () => {
  it("returns null for anything that isn't the envelope", () => {
    expect(parseOpenRouterError("not json")).toBeNull();
    expect(parseOpenRouterError('{"choices":[]}')).toBeNull();
    expect(parseOpenRouterError('{"error":{}}')).toBeNull();
  });

  it("strips trailing punctuation off a URL found in prose", () => {
    const body = JSON.stringify({
      error: { message: "nope", metadata: { remedy_hint: "See https://example.com/fix." } },
    });
    expect(parseOpenRouterError(body)?.fixUrl).toBe("https://example.com/fix");
  });

  it("finds a URL nested inside ineligibility_reasons", () => {
    expect(parseOpenRouterError(GUARDRAIL)?.fixUrl).toBe(
      "https://openrouter.ai/workspaces/acre-agents/guardrails"
    );
  });
});

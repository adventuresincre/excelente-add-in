import { useCallback, useMemo, useState } from "react";
import { useApp, type PerModelStat } from "../ui/taskpane/AppProvider";
import { ChatPanel } from "../ui/taskpane/chat";
import type { PlanItem } from "../ui/taskpane/chat";
import { useAgentStream } from "../ui/taskpane/chat";
import { HistoryPanel } from "../ui/taskpane/history";
import { SettingsPanel } from "../ui/taskpane/settings";
import { useModels } from "../ui/taskpane/settings/useModels";
import { resolveDefaultVisionModelId } from "../ui/taskpane/settings/model-grouping";
import { CapabilitiesPanel, type CapabilitySection } from "../ui/taskpane/capabilities";
import { edition, useHostedPickerRows } from "@edition";
import { hostedModelFor, resolveUpstreamModelId } from "../edition/hosted";
// The plan renders inside ChatPanel (pinned strip + overlay sheet); App only
// derives it, because both the strip and the promote/review actions need the
// same stream this component owns.

type View = "chat" | "capabilities" | "history" | "settings";

export function App() {
  const {
    loading,
    apiKey,
    // The RUNNING preference, not the stored choice: without a key the
    // choice may be waiting and the edition's fallback is what answers.
    runningModelPref: modelPref,
    sessionCost,
    cacheStats,
    perModelStats,
    chatMode,
    setChatMode,
    resetSession,
    openrouter,
  } = useApp();
  const [view, setView] = useState<View>("chat");
  const [capabilitiesSection, setCapabilitiesSection] =
    useState<CapabilitySection>("skills");
  const openCapabilities = useCallback((section: CapabilitySection) => {
    setCapabilitiesSection(section);
    setView("capabilities");
  }, []);

  // Pre-loads the OpenRouter model list (the OpenRouter client caches it for
  // an hour so this is free if Settings already triggered the fetch). Used to
  // auto-default the vision model when the user hasn't configured an
  // override, and to resolve first-run byokDefaults against the live catalog.
  const { models } = useModels(
    openrouter,
    apiKey
  );
  // The edition's hosted rows: never in the OpenRouter list, so the vision
  // resolver is told about them separately.
  const hostedRows = useHostedPickerRows();
  // Null means "images go straight to the primary" — see
  // `resolveDefaultVisionModelId` for why that is the preferred answer.
  const defaultVisionModelId = useMemo(
    () => resolveDefaultVisionModelId(models, modelPref, hostedRows),
    [models, modelPref, hostedRows]
  );

  // The primary's reasoning policy has to travel with the request: without
  // it "off" can only omit the parameter, which leaves reasoning on for
  // every model that reasons by default. A hosted tier's pinned model is not
  // in the OpenRouter list (the sentinel isn't a real id), so its policy is
  // resolved from the id the host actually runs.
  const reasoningPolicy = useMemo(() => {
    const primaryId = modelPref?.modelId;
    if (!primaryId) return undefined;
    const lookupId = resolveUpstreamModelId(edition.hostedModels, primaryId);
    return models.find((m) => m.id === lookupId)?.reasoningPolicy;
  }, [models, modelPref?.modelId]);

  // Lifted into App so every tab reads the same stream. All views drive the
  // same single conversation.
  const stream = useAgentStream({
    modelId: modelPref?.modelId
      ? resolveUpstreamModelId(edition.hostedModels, modelPref.modelId)
      : null,
    reasoning: modelPref?.reasoning ?? "off",
    reasoningPolicy,
    subagentModelId: modelPref?.subagentModelId
      ? resolveUpstreamModelId(edition.hostedModels, modelPref.subagentModelId)
      : null,
    visionModelId: defaultVisionModelId,
    summaryModelId: modelPref?.summaryModelId
      ? resolveUpstreamModelId(edition.hostedModels, modelPref.summaryModelId)
      : null,
    maxTurns: modelPref?.maxTurns ?? null,
  });

  // Derive the most recent plan in the conversation. Becomes null when the
  // chat is reset.
  const currentPlan = useMemo<PlanItem | null>(() => {
    for (let i = stream.items.length - 1; i >= 0; i--) {
      const it = stream.items[i];
      if (it.kind === "plan") return it;
    }
    return null;
  }, [stream.items]);

  const promoteToWork = useCallback(() => {
    setChatMode("work");
    // Imperative, fire-and-forget phrasing — Gemini-class models otherwise
    // interpret "step by step" as "pause between steps for confirmation".
    void stream.send(
      "Execute every step of the plan above end-to-end, autonomously. Do NOT pause between steps and do NOT send a chat message between steps. " +
        "For each step in order: (1) call `update_plan_step` with status \"in-progress\", (2) make at most 1–2 inspect_workbook(scope=\"range\") calls if you need more context, (3) call write_range / format_range to do the work, (4) call `update_plan_step` with status \"done\", (5) immediately start the next step. " +
        "Only stop and send a chat message when EVERY step is \"done\" — or if a step is genuinely blocked because you need user input you don't have."
    );
    setView("chat");
  }, [setChatMode, stream]);

  const requestReview = useCallback(() => {
    void stream.send(
      "Spawn a reviewer sub-agent to critique the plan above. The reviewer should have read-only " +
        "tools and be told to look for: (1) missing or redundant steps, (2) ordering issues / hidden " +
        "dependencies, (3) per-step risks or assumptions, (4) overall confidence (low / medium / high). " +
        "Then summarize the reviewer's feedback for me in 3–5 bullets. Do NOT modify the plan yet — wait " +
        "for me to decide what to do with the review."
    );
    setView("chat");
  }, [stream]);

  if (loading) {
    return (
      <div className="app">
        <div className="app__loading">Loading…</div>
      </div>
    );
  }

  // Drives three things in the session-info popover when a hosted tier is
  // running: the model row names the live pinned model, the session-cost
  // label takes an asterisk, and the footnote appears — because on such a
  // tier that number is the host's spend, not the user's.
  const hostedRunning = hostedModelFor(edition.hostedModels, modelPref?.modelId);
  const costNote = hostedRunning?.costNote;

  return (
    <div className="app">
      <header className="app-header">
        {/* The app had no h1 at all — every panel started at h2, so the
            document had no top-level heading to orient from. Visually
            hidden because the brand is carried by the taskpane chrome. */}
        <h1 className="sr-only">Excelente</h1>
        <nav className="app-header__nav" aria-label="Primary">
          <button
            type="button"
            className={`app-header__tab${view === "chat" ? " is-active" : ""}`}
            aria-current={view === "chat" ? "page" : undefined}
            onClick={() => setView("chat")}
          >
            Chat
          </button>
          <button
            type="button"
            className={`app-header__tab${view === "capabilities" ? " is-active" : ""}`}
            aria-current={view === "capabilities" ? "page" : undefined}
            onClick={() => setView("capabilities")}
            title="Skills & connectors"
          >
            Capabilities
          </button>
          <button
            type="button"
            className={`app-header__tab${view === "history" ? " is-active" : ""}`}
            aria-current={view === "history" ? "page" : undefined}
            onClick={() => setView("history")}
            title="Saved conversations for this workbook"
          >
            History
          </button>
          <button
            type="button"
            className={`app-header__tab${view === "settings" ? " is-active" : ""}`}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
        </nav>
        <button
          type="button"
          className="app-header__new"
          onClick={() => {
            // Auto-save persists the current conversation to IndexedDB
            // before we reset, so it stays accessible from the History
            // tab. reset() cancels any in-flight turn, clears items,
            // mints a fresh conversation id on the next send.
            stream.reset();
            setView("chat");
          }}
          aria-label="New chat"
          title="New chat. Saves the current one to History and opens a fresh thread"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <details className="app-header__info">
          <summary
            className="app-header__info-summary"
            aria-label="Session info"
            title="Session info"
          >
            {sessionCost > 0 ? formatCost(sessionCost) : "info"}
          </summary>
          <div className="app-header__info-popover">
            <div className="app-header__info-row">
              <span className="app-header__info-label">Model</span>
              <span className="app-header__info-value">
                {hostedRunning ? (
                  <hostedRunning.LiveName />
                ) : modelPref?.modelId ? (
                  shortModel(modelPref.modelId)
                ) : (
                  "—"
                )}
              </span>
            </div>
            {modelPref?.reasoning && modelPref.reasoning !== "off" && (
              <div className="app-header__info-row">
                <span className="app-header__info-label">Reasoning</span>
                <span className="app-header__info-value app-header__info-value--reasoning">
                  {modelPref.reasoning}
                </span>
              </div>
            )}
            <div className="app-header__info-row">
              {/* The asterisk points at the note below, which only exists
                  when someone else is paying. */}
              <span className="app-header__info-label">
                Session cost{costNote ? "*" : ""}
              </span>
              <span className="app-header__info-value app-header__info-value--cost">
                {formatCost(sessionCost)}
              </span>
            </div>
            {(cacheStats.read > 0 || cacheStats.created > 0) && (
              <div className="app-header__info-row">
                <span className="app-header__info-label">Prompt cache</span>
                <span
                  className="app-header__info-value"
                  title={`${cacheStats.read.toLocaleString()} tokens read from cache, ${cacheStats.created.toLocaleString()} written this session`}
                >
                  {formatCacheStats(cacheStats)}
                </span>
              </div>
            )}
            <PerModelCacheBreakdown stats={perModelStats} />
            <div className="app-header__info-row">
              <span className="app-header__info-label">Version</span>
              <span className="app-header__info-value">
                Excelente <em>alpha</em>
              </span>
            </div>
            {/* Last of the informational content, above the one control —
                the number it annotates is three rows up. */}
            {costNote && <p className="app-header__info-note">{costNote}</p>}
            {sessionCost > 0 && (
              <button
                type="button"
                className="app-header__info-reset"
                onClick={resetSession}
              >
                Reset session cost
              </button>
            )}
          </div>
        </details>
      </header>
      <main className="app-body">
        {/*
          All views stay mounted; we toggle visibility instead of conditionally
          rendering. Preserves Composer text + attachments + plan state when
          the user clicks between tabs.
        */}
        <div className="app-view" hidden={view !== "chat"}>
          <ChatPanel
            stream={stream}
            chatMode={chatMode}
            setChatMode={setChatMode}
            onOpenCapabilities={openCapabilities}
            plan={currentPlan}
            onPromoteToWork={promoteToWork}
            onRequestReview={requestReview}
            apiKey={apiKey}
            modelPref={modelPref}
            onOpenSettings={() => setView("settings")}
          />
        </div>
        <div className="app-view" hidden={view !== "capabilities"}>
          <CapabilitiesPanel
            section={capabilitiesSection}
            onSectionChange={setCapabilitiesSection}
          />
        </div>
        <div className="app-view" hidden={view !== "history"}>
          <HistoryPanel
            activeConversationId={stream.conversationId}
            visible={view === "history"}
            lastSavedAt={stream.lastSavedAt}
            onLoad={(id) => {
              void stream.loadConversation(id);
              setView("chat");
            }}
          />
        </div>
        <div className="app-view" hidden={view !== "settings"}>
          <SettingsPanel />
        </div>
      </main>
    </div>
  );
}

/**
 * Used for the per-model cost breakdown, whose keys are the RESOLVED
 * OpenRouter ids actually called — so the hosted branch here is only for
 * the rare caller that passes a stored pref id.
 */
function shortModel(id: string): string {
  const hosted = hostedModelFor(edition.hostedModels, id);
  if (hosted) return hosted.name;
  const parts = id.split("/");
  return parts[parts.length - 1] ?? id;
}

function formatCost(usd: number): string {
  if (usd <= 0) return "$0.00";
  if (usd < 0.001) return `$${(usd * 1000).toFixed(2)}m`; // milli-dollars for tiny amounts
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatCacheStats(stats: { read: number; created: number }): string {
  // Cache reads are billed at ~10% of full input rate, so reads >> writes is
  // the win condition. Display as a compact "read/created" pair with a hit-
  // share when there's enough signal to compute one.
  if (stats.read === 0 && stats.created === 0) return "—";
  const total = stats.read + stats.created;
  const sharePct = total > 0 ? Math.round((stats.read / total) * 100) : 0;
  return `${formatTokenCount(stats.read)} read · ${sharePct}% hit`;
}

function formatTokenCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${n}`;
}

/**
 * Wave 10b — per-model cache breakdown shown in the /cost popover. Lets
 * the user verify each model in their setup (primary, subagent, vision,
 * summary) is actually caching. Hidden when only one model has been
 * called (the aggregate "Prompt cache" row above covers that case).
 */
function PerModelCacheBreakdown({ stats }: { stats: Record<string, PerModelStat> }) {
  const entries = Object.entries(stats).filter(([, s]) => s.calls > 0);
  if (entries.length < 2) return null; // single-model session — aggregate row is enough
  entries.sort((a, b) => b[1].cost - a[1].cost); // most-expensive first

  return (
    <div className="app-header__info-section">
      <div className="app-header__info-section-label">Per model</div>
      {entries.map(([modelId, s]) => {
        const totalInput = s.promptTokens;
        const hitPct = totalInput > 0 ? Math.round((s.cacheReadTokens / totalInput) * 100) : 0;
        return (
          <div className="app-header__info-row app-header__info-row--small" key={modelId}>
            <span className="app-header__info-label" title={modelId}>
              {shortModel(modelId)}
            </span>
            <span
              className="app-header__info-value"
              title={`${s.calls} call${s.calls === 1 ? "" : "s"} · ${formatTokenCount(s.promptTokens)} prompt tokens · ${formatTokenCount(s.cacheReadTokens)} cache reads · ${formatCost(s.cost)} spent`}
            >
              {s.cacheReadTokens > 0
                ? `${hitPct}% cache · ${formatCost(s.cost)}`
                : `no cache · ${formatCost(s.cost)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

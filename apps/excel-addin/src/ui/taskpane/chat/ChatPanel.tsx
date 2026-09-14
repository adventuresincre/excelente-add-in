import { memo, useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useApp, type ChatMode } from "../AppProvider";
import { ApprovalCard } from "./ApprovalCard";
import { AskUserCard } from "./AskUserCard";
import { ChangeCard } from "./ChangeCard";
import { SkillProposalCard } from "./SkillProposalCard";
import { TodoCard } from "./TodoCard";
import { Composer, type ComposerHandle } from "./Composer";
import type { CapabilitySection } from "./CapabilityMenu";
import { MessageBubble } from "./MessageBubble";
import { PlanPill } from "./PlanPill";
import { PlanView } from "../plan";
import { SystemNotice } from "./SystemNotice";
import { ToolLine } from "./ToolLine";
import { TypingIndicator } from "./TypingIndicator";
import { ContinuePrompt } from "./ContinuePrompt";
import { pauseReasonFor } from "./pause-reason";
import type { PlanItem, ToolItem, TurnItem, UseAgentStream } from "./useAgentStream";
import { useExcelSelection } from "./useExcelSelection";
import type { ModelPref } from "../../../core/storage";
import { BUILTIN_COMMANDS, type SlashCommand } from "../../../core/commands";
import {
  acreFreeLabel,
  isAcreFreeModel,
  isSetupComplete,
  resolveOpenRouterModelId,
} from "../../../core/config";
import { useAcreFreeInfo } from "../useAcreFreeInfo";
import { ConnectSetup } from "./ConnectSetup";
import "./chat.css";

/**
 * Prompt sent to the agent when the user types `/init`. Drives an Explore
 * subagent → memory-file draft → approval-gated write_workbook_memory.
 * The existing approval card serves as the user's review step — they see
 * the proposed memory content before it's written to the hidden sheet.
 */
const INIT_PROMPT = `Bootstrap this workbook's memory.

1. Spawn an Explore subagent with task: "Read the workbook outline and the outlines of each non-hidden sheet. Return a structured summary: (a) sheet purposes (one line per sheet), (b) named-range inventory with what each refers to, (c) any modeling conventions you can infer (currency units, decimal places, date formats, hardcoded vs. formula patterns), and (d) ambiguities or open questions the workbook author should clarify."

2. Read the existing workbook memory (in case there's already one to merge with).

3. Draft a concise markdown memory file under ~600 words. Use sections: Conventions, Sheet Purposes, Named Ranges, Notes. Each entry one line where possible.

4. Call write_workbook_memory to propose the draft. The user will see your proposal in the approval card and decide whether to write it.

Be concise — workbook memory should be a tight reference, not a transcript of everything you saw.`;

/**
 * Prompt sent when the user types `/skillify`. Drives the agent to
 * propose a new (or updated) skill based on workflows visible in the
 * current conversation.
 */
const SKILLIFY_PROMPT = `Propose a skill from this conversation.

1. Re-read the recent turns. Identify the workflow we just executed — what did the user ask for, what tools did you call, what playbook would have made this easier next time?

2. Call find_skill with a phrase capturing that workflow. Read the top matches' descriptions.

3. Decide:
   - If a close-enough skill exists → propose_skill with kind="update" and a focused enhancement (new section, missing footgun, refined whenToUse); state the reason.
   - If nothing close exists AND the workflow has 3+ steps, decision branches, or will recur → propose_skill with kind="create" and a clean SKILL.md body. Sections: When to use / Approach (numbered) / What to flag / How to phrase the report.
   - If the workflow is one-off / trivial → just tell the user it's not skill-worthy and why.

The user will review your proposal in an inline card and accept or dismiss. Be specific in the body — generic skills are useless skills.`;

interface ChatPanelProps {
  stream: UseAgentStream;
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;
  /** Open the Capabilities tab on a section — from the composer "+" menu. */
  onOpenCapabilities: (section: CapabilitySection) => void;
  /** Most recent plan in this conversation, or null. Owned by App because
   *  it is derived from the same stream both tabs read. */
  plan: PlanItem | null;
  onPromoteToWork: () => void;
  onRequestReview: () => void;
  apiKey: string | null;
  modelPref: ModelPref | null;
}

export function ChatPanel({
  stream,
  chatMode,
  setChatMode,
  onOpenCapabilities,
  plan,
  onPromoteToWork,
  onRequestReview,
  apiKey,
  modelPref,
}: ChatPanelProps) {
  const { openrouter, sessionCost } = useApp();
  const composerRef = useRef<ComposerHandle>(null);
  const selection = useExcelSelection();
  const setupComplete = isSetupComplete(apiKey, modelPref?.modelId ?? null);

  // The plan sheet slides over the transcript rather than living on its own
  // tab: a plan is what you watch WHILE the agent works, and a tab makes
  // checking progress cost your place in the stream. Closing restores the
  // scroll position for free because nothing unmounts.
  const [planSheetOpen, setPlanSheetOpen] = useState(false);
  const openPlan = useCallback(() => setPlanSheetOpen(true), []);
  const closePlan = useCallback(() => setPlanSheetOpen(false), []);
  // A plan can vanish under an open sheet (New chat, or loading another
  // conversation). Close rather than stranding the user on "No plan yet".
  useEffect(() => {
    if (!plan) setPlanSheetOpen(false);
  }, [plan]);

  // A run ended (Stop, error, or the model finished in the same beat) with
  // steering messages still queued. They never reached the model — put the
  // text back in the composer instead of dropping what the user typed.
  useEffect(() => {
    if (stream.busy || stream.queuedSteering.length === 0) return;
    const restored = stream.queuedSteering.map((q) => q.text).join("\n");
    stream.clearQueuedSteering();
    composerRef.current?.prefill(restored);
  }, [stream, stream.busy, stream.queuedSteering]);

  const handleUndo = useCallback(async () => {
    try {
      const label = await stream.undoLast();
      if (label) {
        stream.pushSystemNotice({
          icon: "↶",
          title: "Reverted",
          body: label,
        });
      } else {
        stream.pushSystemNotice({
          icon: "ℹ",
          title: "Nothing to undo",
          body: "No agent writes are on the undo stack for this conversation.",
        });
      }
    } catch (e) {
      stream.pushSystemNotice({
        icon: "✗",
        title: "Undo failed",
        body: (e as Error).message,
      });
    }
  }, [stream]);

  const handleSlashCommand = useCallback(
    (command: SlashCommand) => {
      switch (command.name) {
        case "plan":
          setChatMode("plan");
          stream.pushSystemNotice({
            icon: "📋",
            title: "Switched to Plan mode",
            body: "The agent will propose a numbered plan and stop for your review before any writes.",
          });
          break;
        case "work":
          setChatMode("work");
          stream.pushSystemNotice({
            icon: "✓",
            title: "Switched to Work mode",
            body: "The agent will execute directly; writes still require your approval.",
          });
          break;
        case "clear":
          stream.reset();
          break;
        case "help":
          stream.pushSystemNotice({
            icon: "ℹ",
            title: "Slash commands",
            body: BUILTIN_COMMANDS.map((c) => `/${c.name.padEnd(8)} — ${c.description}`).join("\n"),
          });
          break;
        case "cost":
          stream.pushSystemNotice({
            icon: "💰",
            title: "Session cost",
            body:
              sessionCost === 0
                ? "No usage recorded yet this session."
                : sessionCost < 0.001
                  ? `$${(sessionCost * 1000).toFixed(2)}m (sub-millidollar)`
                  : `$${sessionCost.toFixed(4)}`,
          });
          break;
        case "undo":
          void handleUndo();
          break;
        case "init":
          void stream.send(INIT_PROMPT);
          break;
        case "skillify":
          void stream.send(SKILLIFY_PROMPT);
          break;
      }
    },
    [setChatMode, stream, sessionCost, handleUndo]
  );

  // Identify the head of the visible write history — the most recent
  // un-reverted ChangeCard. Only that card can be reverted in-place because
  // the undo stack is linear; reverting an earlier card would require
  // resolving against later writes to the same range.
  const revertableCallId = useMemo(() => {
    for (let i = stream.items.length - 1; i >= 0; i--) {
      const it = stream.items[i];
      if (
        it.kind === "tool" &&
        it.status === "result" &&
        !it.reverted &&
        isChangeCardTool(it.toolName)
      ) {
        return it.callId;
      }
    }
    return null;
  }, [stream.items]);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);

  // Fetch model info for the current model so we can warn when attachments
  // are sent to a non-vision-capable model.
  const [supportsVision, setSupportsVision] = useState<boolean | null>(null);
  useEffect(() => {
    if (!apiKey || !modelPref?.modelId) {
      setSupportsVision(null);
      return;
    }
    let cancelled = false;
    openrouter
      .listModels(apiKey)
      .then((models) => {
        if (cancelled) return;
        const found = models.find(
          (m) => m.id === resolveOpenRouterModelId(modelPref.modelId)
        );
        setSupportsVision(found?.supportsVision ?? false);
      })
      .catch(() => {
        if (!cancelled) setSupportsVision(null);
      });
    return () => {
      cancelled = true;
    };
  }, [apiKey, modelPref?.modelId, openrouter]);

  const hasAttachmentInHistory = useMemo(
    () =>
      stream.items.some((it) => it.kind === "user" && it.attachments && it.attachments.length > 0),
    [stream.items]
  );

  // A run that ends with work left over used to be invisible: the typing
  // indicator disappeared and the composer came back, which looks exactly
  // like success. Derive the reason from state already on screen (the finish
  // reason plus the agent's own checklist) and offer a way to resume.
  const [pauseDismissed, setPauseDismissed] = useState(false);
  useEffect(() => {
    // A new run answers the question, whatever the user chose last time.
    if (stream.busy) setPauseDismissed(false);
  }, [stream.busy]);
  const pauseReason = useMemo(
    () =>
      pauseDismissed
        ? null
        : pauseReasonFor(stream.hitTurnLimit, stream.items, modelPref?.maxTurns ?? null),
    [pauseDismissed, stream.hitTurnLimit, stream.items, modelPref?.maxTurns]
  );

  const listRef = useRef<HTMLDivElement>(null);
  // Sticks to the bottom while streaming when the user hasn't scrolled up
  // to read prior messages, and shows a "jump to bottom" button when they
  // have. Threshold (64px) keeps small content jitters from unsticking.
  // Tracked as state (not a ref) because the button visibility depends on
  // it — re-rendering when stick-state changes is necessary.
  const [stuckToBottom, setStuckToBottom] = useState(true);
  const onListScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const stuck = distanceFromBottom <= 64;
    setStuckToBottom((prev) => (prev === stuck ? prev : stuck));
  }, []);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !stuckToBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [stream.items, stream.approval.pending, stream.error, pauseReason, stuckToBottom]);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setStuckToBottom(true);
  }, []);

  // A.CRE Free carries no key — A.CRE's proxy supplies one server-side —
  // so "set up" is exactly isSetupComplete and nothing else.
  const disabled = !setupComplete;
  const disabledHint = "Finish setup above to begin.";

  const onDragEnter = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setDragOver(true);
    },
    [disabled]
  );

  const onDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      if (disabled) return;
      if (!e.dataTransfer.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    [disabled]
  );

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      dragDepthRef.current = 0;
      setDragOver(false);
      if (disabled) return;
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      composerRef.current?.attachFiles(files);
    },
    [disabled]
  );

  return (
    <div
      className={`chat-panel${dragOver ? " chat-panel--drag-over" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="chat-panel__drop-overlay" aria-hidden="true">
          <div className="chat-panel__drop-overlay-text">Drop to attach</div>
        </div>
      )}
      {/* Pinned above the scroller, so progress stays visible through a long
          autonomous run instead of scrolling away exactly when it matters.
          Costs one row, and only while a plan exists. */}
      {plan && (
        <div className="chat-panel__plan-strip">
          <PlanPill
            planId={plan.planId}
            steps={plan.steps}
            onOpen={openPlan}
            expanded={planSheetOpen}
          />
        </div>
      )}
      {/*
        role="log" + aria-live="polite" so a screen-reader user hears the
        agent's replies and tool activity as they arrive. Without it the
        transcript updated silently and the only way to know anything had
        happened was to go looking. "polite" (not assertive) so streaming
        text queues behind whatever the user is doing rather than
        interrupting them mid-sentence.
      */}
      <div
        className="chat-panel__messages"
        ref={listRef}
        onScroll={onListScroll}
        role="log"
        aria-live="polite"
        aria-relevant="additions text"
        aria-label="Conversation"
      >
        {/* The wizard renders whenever setup is incomplete — INCLUDING over a
            restored transcript. Gating it on an empty transcript once locked
            the composer with a hint pointing at UI that never appeared. */}
        {!setupComplete && <ConnectSetup />}
        {setupComplete && stream.items.length === 0 && !stream.error && (
          <EmptyState modelId={modelPref?.modelId ?? null} />
        )}
        {stream.items.map((item) => (
          <ItemView
            key={item.id}
            item={item}
            onOpenPlan={openPlan}
            revertableCallId={revertableCallId}
            onRevert={handleUndo}
          />
        ))}
        {stream.busy && <TypingIndicator lastItem={stream.items[stream.items.length - 1]} />}
        {pauseReason && !stream.busy && (
          <ContinuePrompt
            reason={pauseReason}
            onContinue={() => void stream.send("Continue")}
            onDismiss={() => setPauseDismissed(true)}
          />
        )}
        {stream.error && (
          <div className="chat-panel__error" role="alert">
            {stream.error}
          </div>
        )}
      </div>

      {!stuckToBottom && stream.items.length > 0 && (
        <button
          type="button"
          className="chat-panel__jump-bottom"
          onClick={scrollToBottom}
          aria-label="Jump to latest message"
          title="Jump to latest message"
        >
          <span aria-hidden="true">↓</span>
        </button>
      )}

      {hasAttachmentInHistory && supportsVision === false && (
        <div className="chat-panel__warning" role="alert">
          The active model doesn't accept image input. Switch to a vision-capable model (look for
          the
          <code> [vis]</code> tag in Settings) so attachments are actually read.
        </div>
      )}

      {stream.approval.pending && (
        <ApprovalCard call={stream.approval.pending} onDecide={stream.approval.decide} />
      )}

      {stream.askUser.pending && (
        <AskUserCard
          pending={stream.askUser.pending}
          onRespond={stream.askUser.respond}
          onCancel={stream.askUser.cancel}
        />
      )}

      {stream.skillProposal.pending && (
        <SkillProposalCard
          pending={stream.skillProposal.pending}
          onAccept={stream.skillProposal.accept}
          onDismiss={stream.skillProposal.dismiss}
        />
      )}

      {stream.queuedSteering.length > 0 && (
        <div className="steering-queue" role="status" aria-label="Messages queued for the agent">
          {stream.queuedSteering.map((q) => (
            <div key={q.id} className="steering-queue__pill">
              <span className="steering-queue__icon" aria-hidden="true">
                ⏳
              </span>
              <span className="steering-queue__text" title={q.text}>
                {q.text}
              </span>
              <span className="steering-queue__meta">queued, delivers at the next step</span>
              <button
                type="button"
                className="steering-queue__cancel"
                onClick={() => stream.cancelSteering(q.id)}
                aria-label={`Withdraw queued message: ${q.text}`}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {stream.approval.approveAllActive && !stream.approval.pending && (
        <div className="approve-all-pill" role="status">
          <span>Approve-all is on for this chat.</span>
          <button
            type="button"
            className="approve-all-pill__off"
            onClick={stream.approval.resetApproveAll}
          >
            Turn off
          </button>
        </div>
      )}

      <Composer
        ref={composerRef}
        onSend={(text, attachments, sel) => void stream.send(text, attachments, sel)}
        onInterject={(text, sel) => stream.interject(text, sel)}
        selection={selection}
        onCancel={stream.cancel}
        busy={stream.busy}
        disabled={disabled}
        disabledHint={disabledHint}
        onSlashCommand={handleSlashCommand}
        chatMode={chatMode}
        onChatModeChange={setChatMode}
        canUndo={stream.canUndo}
        onUndo={() => void handleUndo()}
        onOpenCapabilities={onOpenCapabilities}
      />

      {/* Over the panel rather than beside it, on the same absolute-overlay
          pattern as the drop target. Nothing unmounts, so closing returns
          the user to the exact scroll position they left. */}
      {plan && planSheetOpen && (
        <div className="chat-panel__plan-sheet" role="dialog" aria-label="Plan">
          <PlanView
            plan={plan}
            onBack={closePlan}
            onPromoteToWork={() => {
              closePlan();
              onPromoteToWork();
            }}
            onRequestReview={() => {
              closePlan();
              onRequestReview();
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * Memoized alongside MessageBubble: the stream reducer preserves identity
 * for untouched items and the callback props are useCallback-stable, so
 * per-chunk renders touch only the streaming item's row.
 */
const ItemView = memo(ItemViewImpl);

function ItemViewImpl({
  item,
  onOpenPlan,
  revertableCallId,
  onRevert,
}: {
  item: TurnItem;
  onOpenPlan: () => void;
  revertableCallId: string | null;
  onRevert: () => void;
}) {
  if (item.kind === "user") {
    return (
      <MessageBubble
        role="user"
        content={item.content}
        attachments={item.attachments}
        selection={item.selection}
        isStreaming={false}
      />
    );
  }
  if (item.kind === "assistant") {
    return (
      <MessageBubble
        role="assistant"
        content={item.content}
        reasoning={item.reasoning}
        isStreaming={item.isStreaming}
      />
    );
  }
  if (item.kind === "plan") {
    return <PlanPill planId={item.planId} steps={item.steps} onOpen={onOpenPlan} />;
  }
  if (item.kind === "todo") {
    return <TodoCard item={item} />;
  }
  if (item.kind === "system") {
    return <SystemNotice item={item} />;
  }
  if (isChangeCardItem(item)) {
    return (
      <ChangeCard
        item={item}
        canRevert={!item.reverted && item.callId === revertableCallId}
        reverted={Boolean(item.reverted)}
        onRevert={onRevert}
      />
    );
  }
  return <ToolLine item={item} />;
}

/**
 * Tool names whose results should render as a ChangeCard rather than a
 * plain ToolLine. Kept narrow for now — only write_range, the one tool
 * that currently pushes to the undo stack, gets the rich card with
 * revert support. format_range and write_workbook_memory are also workbook
 * mutations but don't yet have undo-stack coverage; they stay as ToolLines
 * until that lands.
 */
function isChangeCardTool(toolName: string): boolean {
  return toolName === "write_range";
}

function isChangeCardItem(item: TurnItem): item is ToolItem {
  return (
    item.kind === "tool" &&
    isChangeCardTool(item.toolName) &&
    (item.status === "result" || item.status === "error")
  );
}

function EmptyState({ modelId }: { modelId: string | null }) {
  const acre = isAcreFreeModel(modelId);
  return (
    <div className="chat-panel__empty">
      <BrandMark />
      <h2>
        Become <em className="accent">AI-native</em>
        <br />
        in your workbook.
      </h2>
      {acre ? (
        <AcreFreeIntro />
      ) : (
        <p>
          You&apos;re talking to <code>{modelId}</code>.
        </p>
      )}
      <p className="chat-panel__empty-hint">
        Ask about this workbook, attach images or PDFs, or request a change. Write tools require
        your approval.
      </p>
    </div>
  );
}


/**
 * Its own component so the /health lookup only happens for users actually
 * on A.CRE Free — a hook here would fire it for every BYOK user too.
 * `modelLabel` is null on first paint and whenever the proxy is
 * unreachable, and the sentence then reads "You're using A.CRE Free." —
 * true, just less specific.
 */
function AcreFreeIntro() {
  const { modelLabel } = useAcreFreeInfo();
  return (
    <p>
      You&apos;re using{" "}
      <span className="connect-setup__nowrap">{acreFreeLabel(modelLabel)}</span>. A.CRE
      covers the cost of this basic model to make AI in Excel accessible to students /
      learners. Please don&apos;t abuse it.
    </p>
  );
}

function BrandMark() {
  return (
    <img
      src="/assets/logo-filled.png"
      alt="Excelente"
      className="chat-panel__brand-mark"
      width={72}
      height={72}
    />
  );
}

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AttachmentPageLimitError,
  AttachmentSizeLimitError,
  blobToDataUrl,
  ImageSizeLimitError,
  isPdfMime,
  isSupportedImageMime,
  type PreparedAttachment,
} from "../../../core/vision";
import type { SelectionInfo } from "../../../core/context";
import { isCoreSkill, type SkillSummary } from "../../../core/skills";
import { filterCommands, type SlashCommand } from "../../../core/commands";
import {
  INSERT_SIZE_LIMIT_BYTES,
  countWorksheets,
  fileToBase64,
  isCsvFile,
  isSpreadsheetFile,
  parseSpreadsheetToText,
  renderSpreadsheetText,
} from "../../../core/attachments";
import { useApp, type ChatMode } from "../AppProvider";
import { detectSlashToken, replaceSlashToken } from "./slash-detect";
import { SlashMenu, type SlashMenuItem } from "./SlashMenu";
import { CapabilityMenu, type CapabilitySection } from "./CapabilityMenu";
import { SpreadsheetDecisionCard } from "./SpreadsheetDecisionCard";
import { ACRE_MCP_PRESETS, type McpServerStatus } from "../../../core/mcp";
import { connectorButtons } from "./connector-buttons";

export interface ComposerProps {
  onSend: (
    text: string,
    attachments: PreparedAttachment[],
    selection: SelectionInfo | null
  ) => void;
  /**
   * Queue a mid-run message. Called instead of onSend when `busy` — the
   * composer stays live during a run so the user can steer without
   * stopping it. Text-only: the attach button is already disabled while
   * busy, so attachments can't reach this path.
   */
  onInterject: (text: string, selection: SelectionInfo | null) => void;
  /**
   * Live Excel selection (from useExcelSelection). Rendered as a
   * dismissible chip; when active it rides along with the sent message so
   * "fix this" resolves to the range the user is looking at.
   */
  selection: SelectionInfo | null;
  onCancel: () => void;
  busy: boolean;
  disabled: boolean;
  /** Shown as placeholder when disabled. */
  disabledHint?: string;
  /**
   * Invoked when the user picks a built-in slash command from the menu.
   * The parent (ChatPanel) owns the side effects (mode switch, reset, etc.)
   * since they touch app-level state outside the Composer.
   */
  onSlashCommand?: (command: SlashCommand) => void;
  /** Plan/Work toggle — rendered inline in the composer's toolbar. */
  chatMode: ChatMode;
  onChatModeChange: (mode: ChatMode) => void;
  /** Undo button — disabled when the undo stack is empty. */
  canUndo: boolean;
  onUndo: () => void;
  /**
   * Open the Capabilities tab on a given section — fired by the "Manage →"
   * links in the "+" (connectors & skills) popover.
   */
  onOpenCapabilities: (section: CapabilitySection) => void;
}

/**
 * Imperative handle exposed via ref so parents (e.g. ChatPanel handling
 * drag-and-drop) can hand files to the Composer for processing.
 */
export interface ComposerHandle {
  attachFiles: (files: FileList | File[] | null | undefined) => void;
  /**
   * Put text back into the input — used by ChatPanel to restore steering
   * messages that were still queued when a run ended (Stop, error), so
   * what the user typed is never silently dropped. Appends below any
   * draft already in the box.
   */
  prefill: (text: string) => void;
}

interface PendingPdf {
  id: string;
  filename: string;
  currentPage: number;
  totalPages: number;
}

const ACCEPT =
  ".png,.jpg,.jpeg,.webp,.gif,.pdf,.xlsx,.xlsm,.xls,.xlsb,.csv," +
  "image/png,image/jpeg,image/webp,image/gif,application/pdf," +
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet," +
  "application/vnd.ms-excel,text/csv";

/**
 * A spreadsheet the user dropped that's awaiting an insert-vs-text
 * decision. Rendered as a SpreadsheetDecisionCard above the textarea.
 */
interface PendingSheet {
  id: string;
  file: File;
  worksheetCount: number;
  /** insert disabled when the host lacks ExcelApi 1.13 or the file is too big. */
  canInsert: boolean;
  /** Reason insert is unavailable, for the card's tooltip. */
  insertDisabledReason?: string;
  /** True while an insert/parse action is running. */
  busy: boolean;
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    onSend,
    onInterject,
    selection,
    onCancel,
    busy,
    disabled,
    disabledHint,
    onSlashCommand,
    chatMode,
    onChatModeChange,
    canUndo,
    onUndo,
    onOpenCapabilities,
  },
  ref
) {
  const {
    pdfRasterizer,
    skillRegistry,
    skillsVersion,
    enabledSkillNames,
    enableSkill,
    ds,
    mcp,
    activeConnectorNames,
    enableConnector,
    disableConnector,
  } = useApp();
  const [pendingSheets, setPendingSheets] = useState<PendingSheet[]>([]);
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [pending, setPending] = useState<PendingPdf[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const prevBusyRef = useRef(busy);

  // ----- selection chip ------------------------------------------------------
  // Dismissal is keyed to the specific range: clicking ✕ hides the chip for
  // THIS selection only, and selecting something else revives it. A single
  // resting cell is almost never intent (it's just where the cursor lives),
  // so the chip only appears for multi-cell ranges — "this range" requests
  // on a single cell still work via the get_selection tool.
  const [dismissedSelectionKey, setDismissedSelectionKey] = useState<string | null>(null);
  const selectionKey = selection ? `${selection.sheetName}!${selection.address}` : null;
  const isMultiCell = selection !== null && selection.address.includes(":");
  const chipSelection =
    selection !== null && isMultiCell && selectionKey !== dismissedSelectionKey
      ? selection
      : null;

  // ----- "+" capability menu (connectors & skills) --------------------------
  const [capMenuOpen, setCapMenuOpen] = useState(false);

  // ----- connector brand toggles (Vic, Hub) ----------------------------------
  // One button per INSTALLED A.CRE preset, right of undo. Same source of
  // truth as the "+" menu (manager statuses + activeConnectorNames), so the
  // two can never disagree. Not-installed presets render nothing.
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>(() => mcp.getStatuses());
  useEffect(() => mcp.subscribe(setMcpStatuses), [mcp]);
  const brandButtons = useMemo(
    () => connectorButtons(mcpStatuses, activeConnectorNames, ACRE_MCP_PRESETS),
    [mcpStatuses, activeConnectorNames]
  );
  const capAnchorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!capMenuOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (capAnchorRef.current && !capAnchorRef.current.contains(e.target as Node)) {
        setCapMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setCapMenuOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [capMenuOpen]);

  // ----- slash menu state ---------------------------------------------------
  const [caret, setCaret] = useState(0);
  const [slashIdx, setSlashIdx] = useState(0);
  const [allSkills, setAllSkills] = useState<SkillSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    skillRegistry
      .list()
      .then((skills) => {
        // Core skills are hidden from the user surface — they're always
        // available to the agent but the user never invokes them via `/`.
        if (!cancelled) setAllSkills(skills.filter((s) => !isCoreSkill(s.name)));
      })
      .catch(() => {
        // ignore — menu just stays empty.
      });
    return () => {
      cancelled = true;
    };
  }, [skillRegistry, skillsVersion]);

  const slashToken = useMemo(() => detectSlashToken(text, caret), [text, caret]);

  const slashItems = useMemo<SlashMenuItem[]>(() => {
    if (!slashToken) return [];
    const q = slashToken.query.toLowerCase();
    const commandItems: SlashMenuItem[] = filterCommands(slashToken.query).map((command) => ({
      kind: "command",
      command,
    }));
    const skillItems: SlashMenuItem[] = allSkills
      .filter((s) => {
        if (!q) return true;
        return s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q);
      })
      .map((summary) => ({
        kind: "skill",
        summary,
        enabled: enabledSkillNames.has(summary.name),
      }));
    return [...commandItems, ...skillItems];
  }, [slashToken, allSkills, enabledSkillNames]);

  useEffect(() => {
    setSlashIdx((i) => {
      if (slashItems.length === 0) return 0;
      return Math.min(i, slashItems.length - 1);
    });
  }, [slashItems.length]);

  const queryKey = slashToken?.query ?? null;
  useEffect(() => {
    setSlashIdx(0);
  }, [queryKey]);

  const slashOpen = slashToken !== null;

  // Auto-grow the textarea up to a CSS-capped max height. Matches Claude
  // Code's composer behavior — short messages stay 2 lines, long ones
  // expand inline so the user can see what they've typed. Past the cap,
  // the textarea grows scrollbar instead of pushing the rest of the chat
  // off-screen.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (disabled) return;
    const wasBusy = prevBusyRef.current;
    prevBusyRef.current = busy;
    if (!busy && (wasBusy || !inputRef.current?.value)) {
      const id = window.setTimeout(() => {
        // Return focus to the composer only if the user has not put it
        // somewhere else while the agent worked. Yanking focus off the
        // Revert button or the mode toggle the instant a run finishes is
        // precisely the "focus moved without me doing anything" failure the
        // FastPass "Input focus" check is about (2026-09-04). Nothing
        // focused (body) or focus already inside the composer → safe.
        const active = document.activeElement;
        const composer = inputRef.current?.closest("form");
        if (active && active !== document.body && composer && !composer.contains(active)) {
          return;
        }
        inputRef.current?.focus();
      }, 0);
      return () => window.clearTimeout(id);
    }
    return;
  }, [busy, disabled]);

  async function processFiles(files: FileList | File[] | null | undefined) {
    if (!files) return;
    setError(null);
    for (const file of Array.from(files)) {
      if (isSupportedImageMime(file.type)) {
        await processImage(file);
      } else if (isPdfMime(file.type)) {
        await processPdf(file);
      } else if (isSpreadsheetFile(file)) {
        await queueSpreadsheet(file);
      } else {
        setError(`Unsupported file type: ${file.type || file.name}`);
      }
    }
  }

  /**
   * A spreadsheet was dropped. CSV has no worksheets to insert, so it goes
   * straight to the text path. Everything else surfaces a decision card
   * (insert worksheets vs. read as text). The insert option is gated on
   * ExcelApi 1.13 support + a size cap.
   */
  async function queueSpreadsheet(file: File) {
    if (isCsvFile(file)) {
      await addSpreadsheetAsText(file);
      return;
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    let worksheetCount = 0;
    try {
      worksheetCount = await countWorksheets(file);
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${(e as Error).message}`);
      return;
    }
    const hostSupportsInsert = ds.supportsWorksheetInsert();
    const tooBig = file.size > INSERT_SIZE_LIMIT_BYTES;
    const canInsert = hostSupportsInsert && !tooBig;
    const insertDisabledReason = !hostSupportsInsert
      ? "Inserting worksheets needs Excel 2021 or Microsoft 365."
      : tooBig
        ? "File is too large to insert — read as text instead."
        : undefined;
    setPendingSheets((p) => [
      ...p,
      { id, file, worksheetCount, canInsert, insertDisabledReason, busy: false },
    ]);
  }

  /** Text path: parse to CSV-per-sheet and add as a spreadsheet attachment. */
  async function addSpreadsheetAsText(file: File) {
    try {
      const parsed = await parseSpreadsheetToText(file);
      setAttachments((prev) => [
        ...prev,
        {
          kind: "spreadsheet",
          filename: file.name,
          pages: [],
          pageCount: parsed.sheets.length,
          csvText: renderSpreadsheetText(parsed),
        },
      ]);
    } catch (e) {
      setError(`Couldn't read ${file.name}: ${(e as Error).message}`);
    }
  }

  /** Insert path: read base64 → insert worksheets → add a pointer attachment.
   * Falls back to text on any Office.js failure (old host, binary quirk,
   * extension-hardening policy, corrupt file). */
  async function insertSpreadsheet(pending: PendingSheet) {
    setPendingSheets((p) =>
      p.map((it) => (it.id === pending.id ? { ...it, busy: true } : it))
    );
    try {
      const base64 = await fileToBase64(pending.file);
      const insertedSheets = await ds.insertWorksheetsFromBase64(base64);
      setAttachments((prev) => [
        ...prev,
        {
          kind: "spreadsheet-inserted",
          filename: pending.file.name,
          pages: [],
          pageCount: insertedSheets.length,
          insertedSheets,
        },
      ]);
      setPendingSheets((p) => p.filter((it) => it.id !== pending.id));
    } catch (e) {
      // Native insert failed — degrade gracefully to the text path so the
      // user still gets something useful.
      setPendingSheets((p) => p.filter((it) => it.id !== pending.id));
      setError(
        `Couldn't insert worksheets from ${pending.file.name} (${(e as Error).message}). Reading as text instead.`
      );
      await addSpreadsheetAsText(pending.file);
    }
  }

  async function readSpreadsheetAsText(pending: PendingSheet) {
    setPendingSheets((p) => p.filter((it) => it.id !== pending.id));
    await addSpreadsheetAsText(pending.file);
  }

  function dismissSpreadsheet(id: string) {
    setPendingSheets((p) => p.filter((it) => it.id !== id));
  }

  useImperativeHandle(
    ref,
    () => ({
      attachFiles: processFiles,
      prefill: (restored: string) => {
        setText((prev) => (prev.trim().length > 0 ? `${prev}\n${restored}` : restored));
        inputRef.current?.focus();
      },
    }),
    []
  );

  async function processImage(file: File) {
    const filename = file.name || "pasted-image.png";
    try {
      const url = await blobToDataUrl(file, { filename });
      const att: PreparedAttachment = {
        kind: "image",
        filename,
        pages: [url],
        pageCount: 1,
      };
      setAttachments((prev) => [...prev, att]);
    } catch (e) {
      // The size error already names the file and says what to do; don't
      // bury it under a second "Failed to read…" wrapper.
      if (e instanceof ImageSizeLimitError) {
        setError(e.message);
        return;
      }
      setError(`Failed to read ${filename}: ${(e as Error).message}`);
    }
  }

  async function processPdf(file: File) {
    const pendingId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    let totalPages = 0;
    const pages: string[] = [];
    setPending((p) => [
      ...p,
      { id: pendingId, filename: file.name, currentPage: 0, totalPages: 0 },
    ]);

    try {
      const buffer = await file.arrayBuffer();
      for await (const event of pdfRasterizer.rasterize(buffer)) {
        totalPages = event.totalPages;
        pages.push(event.pngDataUrl);
        setPending((p) =>
          p.map((it) =>
            it.id === pendingId
              ? { ...it, currentPage: event.pageNumber, totalPages: event.totalPages }
              : it
          )
        );
      }
      setAttachments((prev) => [
        ...prev,
        { kind: "pdf", filename: file.name, pages, pageCount: totalPages },
      ]);
    } catch (e) {
      if (e instanceof AttachmentPageLimitError) {
        setError(e.message);
      } else if (e instanceof AttachmentSizeLimitError) {
        setError(e.message);
      } else {
        setError(`Failed to read ${file.name}: ${(e as Error).message}`);
      }
    } finally {
      setPending((p) => p.filter((it) => it.id !== pendingId));
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  function consumeClipboardImages(items: DataTransferItemList): boolean {
    const files: File[] = [];
    for (const item of Array.from(items)) {
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file && isSupportedImageMime(file.type)) files.push(file);
      }
    }
    if (files.length === 0) return false;
    void processFiles(files);
    return true;
  }

  function submit() {
    const trimmed = text.trim();
    if (disabled) return;
    if (busy) {
      // Mid-run: Enter queues a steering message for the agent's next tool
      // boundary. Text-only — the attach button is disabled while busy, so
      // the attachments guard is just defense in depth.
      if (!trimmed || attachments.length > 0 || pending.length > 0) return;
      onInterject(trimmed, chipSelection);
      setText("");
      setDismissedToken(null);
      return;
    }
    if (!trimmed && attachments.length === 0) return;
    if (pending.length > 0) return; // wait for PDFs to finish
    onSend(trimmed, attachments, chipSelection);
    setText("");
    setAttachments([]);
    setError(null);
    setDismissedToken(null);
  }

  const canSubmit =
    !disabled &&
    !busy &&
    pending.length === 0 &&
    (text.trim().length > 0 || attachments.length > 0);

  // ----- slash-menu interaction --------------------------------------------
  const [dismissedToken, setDismissedToken] = useState<{ start: number; query: string } | null>(
    null
  );

  const slashMenuOpen =
    slashOpen &&
    slashToken !== null &&
    !(
      dismissedToken !== null &&
      dismissedToken.start === slashToken.start &&
      dismissedToken.query === slashToken.query
    );

  const syncCaret = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    setCaret(el.selectionStart ?? 0);
  }, []);

  const selectMenuItem = useCallback(
    (item: SlashMenuItem) => {
      if (!slashToken) return;
      const { text: nextText, caret: nextCaret } = replaceSlashToken(text, slashToken, "");
      setText(nextText);
      setDismissedToken(null);

      if (item.kind === "skill") {
        if (!enabledSkillNames.has(item.summary.name)) {
          enableSkill(item.summary.name);
        }
      } else {
        onSlashCommand?.(item.command);
      }

      requestAnimationFrame(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(nextCaret, nextCaret);
        setCaret(nextCaret);
      });
    },
    [slashToken, text, enabledSkillNames, enableSkill, onSlashCommand]
  );

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {pendingSheets.map((p) => (
        <SpreadsheetDecisionCard
          key={p.id}
          filename={p.file.name}
          worksheetCount={p.worksheetCount}
          isMacroEnabled={/\.xlsm$/i.test(p.file.name)}
          canInsert={p.canInsert}
          insertDisabledReason={p.insertDisabledReason}
          busy={p.busy}
          onInsert={() => void insertSpreadsheet(p)}
          onReadAsText={() => void readSpreadsheetAsText(p)}
          onDismiss={() => dismissSpreadsheet(p.id)}
        />
      ))}

      {(attachments.length > 0 || pending.length > 0 || error) && (
        <div className="composer__attachments">
          {attachments.map((att, idx) => (
            <span key={`att-${idx}`} className={`attach-chip attach-chip--${att.kind}`}>
              {attachIcon(att.kind)}{" "}
              <span className="attach-chip__name">{att.filename}</span>
              {att.kind === "pdf" && (
                <span className="attach-chip__meta"> · {att.pageCount} pages</span>
              )}
              {att.kind === "spreadsheet" && (
                <span className="attach-chip__meta"> · {att.pageCount} sheets (text)</span>
              )}
              {att.kind === "spreadsheet-inserted" && (
                <span className="attach-chip__meta">
                  {" "}
                  · inserted {att.insertedSheets?.length ?? 0} sheet
                  {(att.insertedSheets?.length ?? 0) === 1 ? "" : "s"}
                </span>
              )}
              <button
                type="button"
                className="attach-chip__remove"
                onClick={() => removeAttachment(idx)}
                aria-label={`Remove ${att.filename}`}
              >
                ✕
              </button>
            </span>
          ))}
          {pending.map((p) => (
            <span key={p.id} className="attach-chip attach-chip--pending">
              📄 <span className="attach-chip__name">{p.filename}</span>
              <span className="attach-chip__meta">
                {" "}
                · page {p.currentPage}
                {p.totalPages > 0 ? ` of ${p.totalPages}` : "…"}
              </span>
            </span>
          ))}
          {error && (
            <span className="attach-chip attach-chip--error" role="alert" title={error}>
              {error}
              <button
                type="button"
                className="attach-chip__remove"
                onClick={() => setError(null)}
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </span>
          )}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          void processFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {chipSelection && !disabled && (
        <div className="composer__context">
          <span className="selection-chip" title="Included with your next message">
            <span aria-hidden="true">⌖</span>
            <span className="selection-chip__addr">
              {chipSelection.sheetName}!{chipSelection.address}
            </span>
            <button
              type="button"
              className="selection-chip__remove"
              onClick={() => setDismissedSelectionKey(selectionKey)}
              aria-label={`Don't include selection ${chipSelection.sheetName}!${chipSelection.address}`}
            >
              ✕
            </button>
          </span>
        </div>
      )}

      <div className="composer__input-wrap">
        {slashMenuOpen && (
          <SlashMenu
            query={slashToken?.query ?? ""}
            items={slashItems}
            activeIdx={slashIdx}
            onSelect={selectMenuItem}
            onHover={setSlashIdx}
          />
        )}
        <textarea
          ref={inputRef}
          className="composer__input"
          // The placeholder is not an accessible name — it vanishes as soon
          // as the user types, leaving the control unnamed.
          aria-label="Message Excelente"
          // Slash-menu wiring. Without it a screen reader never announces
          // which item the arrow keys are on; the listbox might as well not
          // exist.
          //
          // NOT role="combobox": ARIA allows combobox on a single-line input,
          // never on a <textarea>, and `aria-expanded` is likewise not
          // supported on a text box. Both were flagged by Accessibility
          // Insights against the live pane (2026-09-04, FastPass on Excel for
          // the web) and are removed. The two attributes that carry the
          // behaviour are valid on a textarea's implicit role=textbox and stay:
          // aria-autocomplete tells AT a completion list exists, and
          // aria-activedescendant announces the highlighted option as the
          // arrow keys move through it.
          aria-autocomplete="list"
          aria-controls={slashMenuOpen ? "slash-menu-list" : undefined}
          aria-activedescendant={
            slashMenuOpen && slashItems.length > 0 ? `slash-opt-${slashIdx}` : undefined
          }
          placeholder={
            disabled
              ? (disabledHint ?? "Disabled")
              : busy
                ? "Steer the agent — Enter queues for its next step"
                : "Ask Excelente…  (type / for commands and skills)"
          }
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            requestAnimationFrame(syncCaret);
          }}
          onClick={syncCaret}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          onKeyDown={(e) => {
            if (slashMenuOpen && slashItems.length > 0) {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setSlashIdx((i) => (i + 1) % slashItems.length);
                return;
              }
              if (e.key === "ArrowUp") {
                e.preventDefault();
                setSlashIdx((i) => (i - 1 + slashItems.length) % slashItems.length);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                const item = slashItems[slashIdx];
                if (item) selectMenuItem(item);
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                if (slashToken) {
                  setDismissedToken({ start: slashToken.start, query: slashToken.query });
                }
                return;
              }
            }
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            if (disabled || busy) return;
            if (consumeClipboardImages(e.clipboardData.items)) {
              e.preventDefault();
            }
          }}
          disabled={disabled}
          rows={2}
        />
      </div>

      <div className="composer__toolbar">
        <div className="composer__menu-anchor" ref={capAnchorRef}>
          {capMenuOpen && (
            <CapabilityMenu
              onManage={onOpenCapabilities}
              onClose={() => setCapMenuOpen(false)}
            />
          )}
          <button
            type="button"
            className={`composer__icon-btn${capMenuOpen ? " is-active" : ""}`}
            onClick={() => setCapMenuOpen((o) => !o)}
            aria-label="Add connectors and skills"
            aria-haspopup="true"
            aria-expanded={capMenuOpen}
            title="Add connectors and skills"
          >
            <PlusIcon />
          </button>
        </div>
        <button
          type="button"
          className="composer__icon-btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || busy}
          aria-label="Attach files"
          title="Attach images or PDFs (or paste / drag-drop)"
        >
          <PaperclipIcon />
        </button>
        <div className="composer__mode" role="group" aria-label="Chat mode">
          <button
            type="button"
            className={`composer__mode-option${chatMode === "plan" ? " is-active" : ""}`}
            aria-pressed={chatMode === "plan"}
            onClick={() => onChatModeChange("plan")}
            title="Plan mode — read-only; agent proposes a numbered plan before any writes."
          >
            Plan
          </button>
          <button
            type="button"
            className={`composer__mode-option${chatMode === "work" ? " is-active" : ""}`}
            aria-pressed={chatMode === "work"}
            onClick={() => onChatModeChange("work")}
            title="Work mode — agent executes directly; writes still require approval."
          >
            Work
          </button>
        </div>
        <button
          type="button"
          className="composer__icon-btn"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Undo last agent write"
          title={
            canUndo ? "Revert the most recent agent write" : "Nothing to undo on this conversation"
          }
        >
          <UndoIcon />
        </button>
        {brandButtons.length > 0 && <span className="composer__brand-sep" aria-hidden="true" />}
        {brandButtons.map((b) => (
          <button
            key={b.preset.id}
            type="button"
            className={`composer__brand composer__brand--${b.state}`}
            aria-pressed={b.state !== "off"}
            aria-label={b.label}
            title={b.label}
            onClick={() => {
              // A toggle cannot fix an expired session — send the user to the
              // connectors menu instead, where Connect / Remove live.
              if (b.state === "error") {
                setCapMenuOpen(true);
                return;
              }
              if (b.state === "off") enableConnector(b.serverName);
              else disableConnector(b.serverName);
            }}
          >
            <img
              className="composer__brand-mark"
              src={b.preset.icon.small}
              alt=""
              width={18}
              height={18}
              draggable={false}
            />
            {b.state === "error" && <span className="composer__brand-dot" aria-hidden="true" />}
          </button>
        ))}
        <div className="composer__toolbar-spacer" />
        {/*
          ONE button whose role swaps, not two that mount and unmount. The
          previous version replaced the DOM node when `busy` flipped, so a
          user who pressed Send with the keyboard had focus dropped to
          <body> at the exact moment Stop became the thing they might want
          — and they had to Tab back in from the top to reach it.
        */}
        <button
          type={busy ? "button" : "submit"}
          className={`composer__send${busy ? " composer__send--stop" : ""}`}
          onClick={busy ? onCancel : undefined}
          disabled={busy ? false : !canSubmit}
          aria-label={busy ? "Stop generating" : "Send message"}
          title={busy ? "Stop" : "Send (Enter)"}
        >
          {busy ? <StopIcon /> : <SendIcon />}
        </button>
      </div>
      <p className="composer__ai-notice">
        Excelente is AI and can make mistakes. Review its work before relying on it.
      </p>
    </form>
  );
});

function attachIcon(kind: PreparedAttachment["kind"]): string {
  switch (kind) {
    case "image":
      return "🖼";
    case "pdf":
      return "📄";
    case "spreadsheet":
    case "spreadsheet-inserted":
      return "📊";
    default:
      return "📎";
  }
}

function PlusIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function SendIcon() {
  return (
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
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="2" />
    </svg>
  );
}

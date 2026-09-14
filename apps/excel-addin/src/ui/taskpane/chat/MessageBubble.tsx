import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SelectionInfo } from "../../../core/context";
import type { PreparedAttachment } from "../../../core/vision";

// GitHub-Flavored Markdown adds: tables, strikethrough, autolinks, task
// lists. Agents (especially Claude / Gemini / GPT) reach for tables
// constantly — without this plugin they render as raw pipe-and-dash text
// inline, which is what users see today.
const REMARK_PLUGINS = [remarkGfm];

export interface MessageBubbleProps {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  /** Image / PDF attachments (rendered on user bubbles). */
  attachments?: PreparedAttachment[];
  /** Excel selection that rode along with this user message. */
  selection?: SelectionInfo | null;
  /** True while this turn is still streaming. */
  isStreaming: boolean;
}

/**
 * Memoized: useAgentStream calls setItems on every SSE chunk, and the
 * ReactMarkdown parse below is the expensive part of a transcript render.
 * The stream reducer preserves object identity for untouched items, so
 * memo confines each chunk's markdown re-parse to the one streaming
 * bubble instead of every historical message.
 */
export const MessageBubble = memo(MessageBubbleImpl);

function MessageBubbleImpl({
  role,
  content,
  reasoning,
  attachments,
  selection,
  isStreaming,
}: MessageBubbleProps) {
  // Reasoning starts closed. The user expands it on demand — most of the
  // time they don't care to see the model's stream-of-consciousness. When
  // reasoning is the only thing in the turn (no content yet), we render
  // the toggle as a standalone muted line OUTSIDE the assistant bubble so
  // there's no near-empty white card waiting on the model to actually
  // start writing.
  const [open, setOpen] = useState(false);

  const reasoningOnly = role === "assistant" && Boolean(reasoning) && !content;
  const hasAttachments = attachments && attachments.length > 0;

  // Standalone toggle when the bubble would otherwise be empty. Looks like
  // a tool-line — single muted row, click to expand. No bubble box.
  if (reasoningOnly && !hasAttachments) {
    return (
      <ReasoningSection
        reasoning={reasoning as string}
        open={open}
        onToggle={() => setOpen((v) => !v)}
        position="standalone"
        isStreaming={isStreaming}
      />
    );
  }

  return (
    <div className={`bubble bubble--${role}`}>
      {hasAttachments && (
        <div className="bubble__attachments">
          {attachments!.map((att, idx) => (
            <AttachmentPreview key={idx} attachment={att} />
          ))}
        </div>
      )}
      {selection && (
        <span
          className="bubble__selection"
          title="Excel selection included with this message"
        >
          <span aria-hidden="true">⌖</span> {selection.sheetName}!{selection.address}
        </span>
      )}
      <div className="bubble__content">
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          components={{
            a: ({ children, href }) => (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
        {isStreaming && <span className="bubble__cursor" aria-hidden="true" />}
      </div>
      {reasoning && (
        <ReasoningSection
          reasoning={reasoning}
          open={open}
          onToggle={() => setOpen((v) => !v)}
          position="below"
        />
      )}
    </div>
  );
}

interface ReasoningSectionProps {
  reasoning: string;
  open: boolean;
  onToggle: () => void;
  position: "above" | "below" | "standalone";
  /**
   * True while the parent turn is still streaming. Used by the standalone
   * variant to show the brand-mark loader to the left of the chevron — so
   * a long reasoning trail reads as "still working" rather than a static
   * collapsed toggle waiting for input. Ignored for inline (above/below)
   * positions; the bubble's own cursor takes care of motion there.
   */
  isStreaming?: boolean;
}

function ReasoningSection({
  reasoning,
  open,
  onToggle,
  position,
  isStreaming,
}: ReasoningSectionProps) {
  const showLoader = position === "standalone" && isStreaming;
  return (
    <div className={`bubble__reasoning bubble__reasoning--${position}`}>
      <button
        type="button"
        className={`bubble__reasoning-toggle${open ? " is-open" : ""}`}
        onClick={onToggle}
        aria-expanded={open}
      >
        {showLoader && <ThinkingLoader />}
        <span className="bubble__reasoning-chevron" aria-hidden="true">
          ▸
        </span>
        <span className="bubble__reasoning-label">thinking</span>
      </button>
      {open && (
        <div className="bubble__reasoning-body">
          <ReactMarkdown
            remarkPlugins={REMARK_PLUGINS}
            components={{
              a: ({ children, href }) => (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              ),
            }}
          >
            {reasoning}
          </ReactMarkdown>
        </div>
      )}
    </div>
  );
}

/**
 * Tiny gold-E loader used inside the standalone "thinking" toggle. The
 * three middle-bar squares pulse in sequence — same animation as the
 * TypingIndicator but smaller (14px) and inline, so a long reasoning
 * stream reads as "still working" right where the row is rendered.
 * Same SVG path as TypingIndicator; CSS animation lives there too via
 * the shared .typing-indicator__logo rect rule.
 */
function ThinkingLoader() {
  return (
    <svg
      className="typing-indicator__logo bubble__reasoning-loader"
      viewBox="0 0 100 100"
      width="14"
      height="14"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M 28 22 L 78 22 L 72 33 L 42 33 L 42 67 L 72 67 L 78 78 L 28 78 Z"
        fill="currentColor"
      />
      <rect x="46" y="46" width="7" height="8" fill="currentColor" />
      <rect x="56" y="46" width="7" height="8" fill="currentColor" />
      <rect x="66" y="46" width="7" height="8" fill="currentColor" />
    </svg>
  );
}

function AttachmentPreview({ attachment }: { attachment: PreparedAttachment }) {
  if (attachment.kind === "image") {
    return (
      <div className="bubble__attachment bubble__attachment--image">
        <img src={attachment.pages[0]} alt={attachment.filename} loading="lazy" />
        <span className="bubble__attachment-name">{attachment.filename}</span>
      </div>
    );
  }
  return (
    <div className="bubble__attachment bubble__attachment--pdf">
      📄 <span className="bubble__attachment-name">{attachment.filename}</span>
      <span className="bubble__attachment-meta">{attachment.pageCount} pages</span>
    </div>
  );
}

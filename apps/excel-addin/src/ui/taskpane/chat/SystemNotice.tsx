import type { SystemNoticeItem } from "./useAgentStream";

interface SystemNoticeProps {
  item: SystemNoticeItem;
}

/**
 * Inline notice card for slash-command output (/help, /cost, /undo
 * confirmations, etc.). Styled distinctly from assistant bubbles so the user
 * sees this as system info rather than agent speech.
 */
export function SystemNotice({ item }: SystemNoticeProps) {
  return (
    <div className="system-notice" role="status">
      <div className="system-notice__title">
        {item.icon && <span className="system-notice__icon">{item.icon}</span>}
        <span>{item.title}</span>
      </div>
      {item.body && <pre className="system-notice__body">{item.body}</pre>}
    </div>
  );
}

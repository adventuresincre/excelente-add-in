import { useCallback, useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import { ConfirmButton } from "../ConfirmButton";
import type { StoredConversation } from "../../../core/storage";
import "./history.css";

interface HistoryPanelProps {
  /** Id of the currently-active conversation, so we can mark it as active. */
  activeConversationId: string | null;
  /**
   * True while the History tab is the visible view. All four views stay
   * mounted (App.tsx toggles `hidden`), so this is the panel's only signal
   * that the user just opened it — without it, nothing re-runs `list()`.
   */
  visible: boolean;
  /**
   * Timestamp of the most recent successful autosave. Changes whenever a
   * conversation lands in the store, which is the other event that makes
   * this list stale.
   */
  lastSavedAt: number;
  /** Called when the user picks a conversation to resume. */
  onLoad: (id: string) => void;
}

/**
 * Lists saved conversations for the current workbook, newest first. Click to
 * resume; trash icon to delete.
 *
 * Refresh triggers (Finding 6, 2026-09-04): the list used to key only on
 * `activeConversationId`, which is minted on the first send — BEFORE the
 * 500 ms-debounced autosave that first writes the conversation. So the one
 * fetch always ran a save too early, and nothing re-ran it: the panel never
 * unmounts, so opening the tab did nothing, and a landed save had no way to
 * signal. History therefore showed the current conversation as missing for
 * its entire life and only caught up when the next one began. That is what
 * every post-fix "History empty" report was actually seeing. Now it also
 * refreshes when the tab becomes visible and when a save lands.
 */
export function HistoryPanel({
  activeConversationId,
  visible,
  lastSavedAt,
  onLoad,
}: HistoryPanelProps) {
  const { conversationStore, workbookId } = useApp();
  const [list, setList] = useState<StoredConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Don't read the store for a tab the user isn't looking at — the panel
    // stays mounted for the whole session, so this effect would otherwise
    // fire on every autosave while the user sits in Chat.
    if (!visible) return;
    let cancelled = false;
    setLoading(true);
    setListError(null);
    void conversationStore
      .list(workbookId)
      .then((rows) => {
        if (!cancelled) setList(rows);
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`Failed to list conversations: ${msg}`);
        setList([]);
        setListError(msg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationStore, workbookId, activeConversationId, refreshKey, visible, lastSavedAt]);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await conversationStore.delete(id);
        setRefreshKey((k) => k + 1);
      } catch (e) {
        console.warn(`Failed to delete conversation: ${(e as Error).message}`);
      }
    },
    [conversationStore]
  );

  if (loading) {
    return (
      <div className="history-panel">
        <div className="history-panel__empty">Loading history…</div>
      </div>
    );
  }

  if (listError) {
    return (
      <div className="history-panel">
        <div className="history-panel__empty" role="alert">
          <p>Couldn&apos;t load saved chats for this workbook.</p>
          <p>The current conversation is still in this pane — reload the add-in and try History again.</p>
        </div>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="history-panel">
        <div className="history-panel__empty">
          <p>No conversations yet for this workbook.</p>
          <p>Conversations auto-save as you chat — they&apos;ll appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="history-panel">
      <h2 className="history-panel__title">History</h2>
      <p className="history-panel__hint">
        Conversations for this workbook, newest first. Click to resume.
      </p>
      <ul className="history-panel__list">
        {list.map((c) => {
          const isActive = c.id === activeConversationId;
          return (
            <li
              key={c.id}
              className={`history-row${isActive ? " is-active" : ""}`}
            >
              <button
                type="button"
                className="history-row__open"
                onClick={() => onLoad(c.id)}
                title={isActive ? "Active conversation" : "Resume this conversation"}
              >
                <div className="history-row__title">{c.title}</div>
                <div className="history-row__meta">
                  <span>{formatTimestamp(c.updatedAt)}</span>
                  <span>·</span>
                  <span>{messageCount(c)} messages</span>
                </div>
              </button>
              <ConfirmButton
                className="history-row__delete"
                question={`Delete "${c.title}"?`}
                confirmLabel="Delete"
                onConfirm={() => handleDelete(c.id)}
                title="Delete this conversation"
                aria-label={`Delete conversation: ${c.title}`}
              >
                ✕
              </ConfirmButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function messageCount(c: StoredConversation): number {
  return c.items.filter(
    (it) => it.kind === "user" || it.kind === "assistant" || it.kind === "plan"
  ).length;
}

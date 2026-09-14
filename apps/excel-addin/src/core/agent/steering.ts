import type { SelectionInfo } from "../context";

/**
 * Mid-run steering: user messages typed while the agent is working.
 *
 * The composer stays live during a run. Anything the user sends lands in a
 * SteeringQueue instead of starting a new turn; the orchestrator drains the
 * queue at the next tool boundary (after a tool batch's results are all in,
 * before the next model call) and appends each entry as an ordinary
 * user-role message. Catching a wrong turn at step 3 beats restarting at
 * step 11.
 *
 * Delivery timing is constrained by the wire format: an assistant message
 * with tool_calls must be followed immediately by its tool results, so a
 * user message may only be inserted once the batch is complete. That
 * boundary is exactly where the orchestrator drains.
 */
export interface SteeringMessage {
  /** UI-minted id — echoed back in the steering-delivered event so the
   * queued pill can be resolved into a transcript item. */
  id: string;
  /** Raw text as the user typed it. */
  text: string;
  /** Excel selection captured when the message was typed, when the
   * composer's selection chip was active. */
  selection?: SelectionInfo | null;
}

export interface SteeringQueue {
  /** Append a message. Safe to call at any point in the run. */
  post(message: SteeringMessage): void;
  /** Remove a not-yet-delivered message (user cancelled the pill).
   * Returns false when the id is unknown — e.g. already delivered. */
  remove(id: string): boolean;
  /** Take everything currently queued, in post order, clearing the queue. */
  drain(): SteeringMessage[];
  size(): number;
}

export function createSteeringQueue(): SteeringQueue {
  let entries: SteeringMessage[] = [];
  return {
    post(message) {
      entries.push(message);
    },
    remove(id) {
      const before = entries.length;
      entries = entries.filter((e) => e.id !== id);
      return entries.length < before;
    },
    drain() {
      const out = entries;
      entries = [];
      return out;
    },
    size() {
      return entries.length;
    },
  };
}

/**
 * Excel-convention sheet qualifier: quoted, with internal apostrophes
 * doubled ('Q3 ''24 Model'!D12:D40). Always quoting is valid even for
 * names that don't need it, and avoids reimplementing Excel's
 * needs-quoting rules.
 */
function qualifySelection(sel: SelectionInfo): string {
  return `'${sel.sheetName.replace(/'/g, "''")}'!${sel.address}`;
}

/**
 * Append the selection note to a user message's wire text. Shared by the
 * live send path, steering delivery, and `itemsToMessages` replay so the
 * model sees one consistent shape. Past tense ("when this message was
 * sent") on purpose — on replay the selection may long since have moved,
 * and the model shouldn't treat an old anchor as the current cursor.
 */
export function appendSelectionNote(text: string, sel: SelectionInfo): string {
  const note = `[User's Excel selection when this message was sent: ${qualifySelection(sel)}]`;
  return text.length > 0 ? `${text}\n\n${note}` : note;
}

/** Wire content for a steering message: raw text plus the selection note. */
export function steeringWireContent(m: SteeringMessage): string {
  return m.selection ? appendSelectionNote(m.text, m.selection) : m.text;
}

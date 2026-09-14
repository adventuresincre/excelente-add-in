import { useCallback, useRef, useState } from "react";

/**
 * One question the agent wants the user to answer before continuing. The
 * shape mirrors the existing AskUserQuestion pattern from Claude Code —
 * multiple-choice options + a free-text fallback.
 */
export interface AskUserQuestion {
  /** The full question text. */
  question: string;
  /** Optional short label / category. */
  header?: string;
  /** Pre-built options. Users can also enter free text. */
  options: Array<{ label: string; description?: string }>;
  /** When true, the user can pick multiple options. */
  multiSelect?: boolean;
}

export interface PendingAskUserQuestion {
  id: string;
  questions: AskUserQuestion[];
}

export interface AskUserResponse {
  /** Per-question answer. For free-text the value is { text: "..." }. */
  answers: Array<
    | { picked: string[] } // option label(s)
    | { text: string } // free-text fallback
    | { cancelled: true } // user dismissed the card
  >;
}

export interface AskUserQueue {
  /** The currently-pending ask, or null. */
  pending: PendingAskUserQuestion | null;
  /** Hand this to the agent tool as the ask callback. */
  ask: (questions: AskUserQuestion[]) => Promise<AskUserResponse>;
  /** Resolves the pending ask with the user's answers. */
  respond: (response: AskUserResponse) => void;
  /** Cancels any pending ask (treats as "cancelled" for every question). */
  cancel: () => void;
}

/**
 * Bridges the agent's async ask-user-question tool to React UI — same
 * pattern as useApprovalQueue, just for structured questions instead of
 * tool-call approvals.
 */
export function useAskUserQueue(): AskUserQueue {
  const [pending, setPending] = useState<PendingAskUserQuestion | null>(null);
  const resolverRef = useRef<((r: AskUserResponse) => void) | null>(null);

  const ask = useCallback((questions: AskUserQuestion[]): Promise<AskUserResponse> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        questions,
      });
    });
  }, []);

  const respond = useCallback((response: AskUserResponse) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.(response);
  }, []);

  const cancel = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.({
      answers: pending ? pending.questions.map(() => ({ cancelled: true as const })) : [],
    });
  }, [pending]);

  return { pending, ask, respond, cancel };
}

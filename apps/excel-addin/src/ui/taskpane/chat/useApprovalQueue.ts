import { useCallback, useRef, useState } from "react";
import type { ApprovalDecision, ToolCallRequest } from "../../../core/agent";

export interface ApprovalQueue {
  /** The currently-pending approval, or null. */
  pending: ToolCallRequest | null;
  /** True when the user clicked "Approve all" earlier this session. */
  approveAllActive: boolean;
  /** Hand this to the orchestrator as `onApprovalRequest`. */
  request: (call: ToolCallRequest) => Promise<ApprovalDecision>;
  /** Resolves the active pending approval with the user's decision. */
  decide: (decision: ApprovalDecision) => void;
  /** Resolves any pending approval as "deny" (used on cancel). */
  cancel: () => void;
  /** Clears the session-wide approve-all latch (used on chat reset). */
  resetApproveAll: () => void;
  /** Set the approve-all latch from outside the UI — used when a workbook
   * override turns auto-approve on. Idempotent. */
  markApproveAll: () => void;
}

/**
 * Bridges the orchestrator's async approval callback to React UI.
 *
 * Approve-all is session-scoped — once the user clicks it, subsequent write
 * tool calls auto-resolve as "approve" until the chat is reset or the user
 * explicitly turns it off via `resetApproveAll`. This persists across multiple
 * orchestrator.run() invocations within the same chat session.
 */
export function useApprovalQueue(): ApprovalQueue {
  const [pending, setPending] = useState<ToolCallRequest | null>(null);
  const [approveAllActive, setApproveAllActive] = useState(false);
  const approveAllRef = useRef(false);
  const resolverRef = useRef<((decision: ApprovalDecision) => void) | null>(null);

  const request = useCallback((call: ToolCallRequest): Promise<ApprovalDecision> => {
    // Honor session-wide approve-all without prompting again.
    if (approveAllRef.current) {
      return Promise.resolve<ApprovalDecision>("approve");
    }
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending(call);
    });
  }, []);

  const decide = useCallback((decision: ApprovalDecision) => {
    if (decision === "approve-all") {
      approveAllRef.current = true;
      setApproveAllActive(true);
    }
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.(decision);
  }, []);

  const cancel = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.("deny");
  }, []);

  const resetApproveAll = useCallback(() => {
    approveAllRef.current = false;
    setApproveAllActive(false);
  }, []);

  const markApproveAll = useCallback(() => {
    if (approveAllRef.current) return;
    approveAllRef.current = true;
    setApproveAllActive(true);
  }, []);

  return {
    pending,
    approveAllActive,
    request,
    decide,
    cancel,
    resetApproveAll,
    markApproveAll,
  };
}

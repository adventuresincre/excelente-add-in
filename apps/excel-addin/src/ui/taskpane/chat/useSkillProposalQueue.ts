import { useCallback, useRef, useState } from "react";

/** A skill the agent wants to propose. Mirrors the SkillSummary + body
 * shape so the install path can persist it directly. */
export interface SkillProposal {
  /** Whether this proposal is a fresh skill or an update to an existing one. */
  kind: "create" | "update";
  name: string;
  description: string;
  whenToUse?: string;
  /** Full markdown playbook (body of SKILL.md). */
  body: string;
  /** Optional bundled reference files keyed by relative path. */
  references?: Record<string, string>;
}

export interface PendingSkillProposal {
  id: string;
  proposal: SkillProposal;
}

export interface SkillProposalResponse {
  outcome: "accepted" | "dismissed";
  /** Set on accepted; the canonical name the skill was stored under. */
  name?: string;
}

export interface SkillProposalQueue {
  pending: PendingSkillProposal | null;
  /** Hand to the propose_skill tool. */
  propose: (proposal: SkillProposal) => Promise<SkillProposalResponse>;
  /** Resolve the pending proposal as accepted. Caller is responsible for
   * actually installing the skill before calling. */
  accept: () => void;
  /** Resolve the pending proposal as dismissed. */
  dismiss: () => void;
}

/**
 * Bridge from the agent's propose_skill tool to UI review.
 * Identical lifecycle pattern as useApprovalQueue / useAskUserQueue.
 */
export function useSkillProposalQueue(): SkillProposalQueue {
  const [pending, setPending] = useState<PendingSkillProposal | null>(null);
  const resolverRef = useRef<((r: SkillProposalResponse) => void) | null>(null);

  const propose = useCallback((proposal: SkillProposal): Promise<SkillProposalResponse> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setPending({
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        proposal,
      });
    });
  }, []);

  const accept = useCallback(() => {
    const proposal = pending?.proposal;
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.({ outcome: "accepted", name: proposal?.name });
  }, [pending]);

  const dismiss = useCallback(() => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setPending(null);
    resolver?.({ outcome: "dismissed" });
  }, []);

  return { pending, propose, accept, dismiss };
}

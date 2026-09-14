import { useState } from "react";
import type { PendingSkillProposal } from "./useSkillProposalQueue";

interface SkillProposalCardProps {
  pending: PendingSkillProposal;
  onAccept: () => void;
  onDismiss: () => void;
}

/**
 * Approval card the agent renders when it wants to propose a new or
 * updated skill. Shows the metadata up front + a collapsible body
 * preview. User accepts (installs the skill) or dismisses.
 */
export function SkillProposalCard({ pending, onAccept, onDismiss }: SkillProposalCardProps) {
  const { proposal } = pending;
  const [showBody, setShowBody] = useState(false);
  const [showRefs, setShowRefs] = useState(false);
  const refKeys = proposal.references ? Object.keys(proposal.references) : [];

  return (
    <div className="skill-proposal-card" role="dialog" aria-label="Skill proposal">
      <div className="skill-proposal-card__header">
        <span className="skill-proposal-card__icon" aria-hidden="true">
          📚
        </span>
        <span className="skill-proposal-card__kind">
          {proposal.kind === "create" ? "New skill" : "Skill update"}
        </span>
        <code className="skill-proposal-card__name">{proposal.name}</code>
      </div>

      <div className="skill-proposal-card__field">
        <span className="skill-proposal-card__label">Description</span>
        <span className="skill-proposal-card__value">{proposal.description}</span>
      </div>

      {proposal.whenToUse && (
        <div className="skill-proposal-card__field">
          <span className="skill-proposal-card__label">When to use</span>
          <span className="skill-proposal-card__value">{proposal.whenToUse}</span>
        </div>
      )}

      <details
        className="skill-proposal-card__details"
        open={showBody}
        onToggle={(e) => setShowBody((e.target as HTMLDetailsElement).open)}
      >
        <summary>Body ({proposal.body.length} chars)</summary>
        <pre className="skill-proposal-card__body">{proposal.body}</pre>
      </details>

      {refKeys.length > 0 && (
        <details
          className="skill-proposal-card__details"
          open={showRefs}
          onToggle={(e) => setShowRefs((e.target as HTMLDetailsElement).open)}
        >
          <summary>References ({refKeys.length})</summary>
          <ul className="skill-proposal-card__ref-list">
            {refKeys.map((key) => (
              <li key={key}>
                <code>{key}</code>{" "}
                <span className="skill-proposal-card__ref-size">
                  ({proposal.references?.[key].length ?? 0} chars)
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="skill-proposal-card__actions">
        <button type="button" className="skill-proposal-card__dismiss" onClick={onDismiss}>
          Dismiss
        </button>
        <button type="button" className="skill-proposal-card__accept" onClick={onAccept}>
          {proposal.kind === "create" ? "Install skill" : "Update skill"}
        </button>
      </div>
    </div>
  );
}

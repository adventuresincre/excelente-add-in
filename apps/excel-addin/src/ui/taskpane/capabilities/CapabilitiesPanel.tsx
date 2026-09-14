import { SkillsPanel } from "../skills";
import { McpSection } from "../settings/McpSection";
import type { CapabilitySection } from "../chat/CapabilityMenu";
// McpSection's markup uses the shared `.settings-*` classes; pull the stylesheet
// in here so Connectors render correctly even when the Settings tab isn't mounted.
import "../settings/settings.css";
import "./capabilities.css";

export type { CapabilitySection };

interface CapabilitiesPanelProps {
  /** Which sub-tab is showing. Controlled by App (deep-linked from "+"). */
  section: CapabilitySection;
  onSectionChange: (section: CapabilitySection) => void;
}

/**
 * The "Capabilities" tab — what the agent can do, and what it is connected
 * to. Two sub-tabs: Skills (playbooks) and Connectors (MCP servers). Both
 * stay mounted so switching is instant and preserves each panel's transient
 * state (upload errors, add-server form). The "load into the agent" toggles
 * live in these panels and in the composer's "+" popover — all routed
 * through the same persisted AppProvider setters.
 *
 * The agent's plan used to be a third sub-tab here. It moved into Chat: a
 * plan is session state and reading it should not mean leaving the stream
 * that is producing it.
 */
export function CapabilitiesPanel({ section, onSectionChange }: CapabilitiesPanelProps) {
  return (
    <div className="capabilities-panel">
      <div
        className="capabilities-panel__tabs"
        role="tablist"
        aria-label="Skills and connectors"
      >
        <button
          type="button"
          role="tab"
          aria-selected={section === "skills"}
          className={`capabilities-panel__tab${section === "skills" ? " is-active" : ""}`}
          onClick={() => onSectionChange("skills")}
        >
          Skills
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === "connectors"}
          className={`capabilities-panel__tab${section === "connectors" ? " is-active" : ""}`}
          onClick={() => onSectionChange("connectors")}
        >
          Connectors
        </button>
      </div>
      <div className="capabilities-panel__body">
        <div className="capabilities-panel__section" role="tabpanel" hidden={section !== "skills"}>
          <SkillsPanel />
        </div>
        <div
          className="capabilities-panel__section capabilities-panel__section--connectors"
          role="tabpanel"
          hidden={section !== "connectors"}
        >
          <McpSection />
        </div>
      </div>
    </div>
  );
}

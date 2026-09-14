import { useEffect, useState } from "react";
import { isCoreSkill, type SkillSummary } from "../../../core/skills";
import type { McpServerStatus } from "../../../core/mcp";
import { useApp } from "../AppProvider";

/**
 * Sub-tabs of the Capabilities tab. The agent's plan is deliberately NOT one
 * of them: Skills and Connectors are durable configuration, the plan is
 * session state that dies with the conversation. It lives in Chat (a pinned
 * strip plus an overlay sheet) so you can watch it without leaving the
 * stream.
 */
export type CapabilitySection = "skills" | "connectors";

interface CapabilityMenuProps {
  /** Open the Capabilities tab on the given section (the "Manage →" link). */
  onManage: (section: CapabilitySection) => void;
  /** Close the popover (after a manage click). */
  onClose: () => void;
}

/**
 * The "+" popover anchored above the composer toolbar. Two sections —
 * Connectors over Skills — each with a "Manage →" link to the Capabilities
 * tab plus a checklist of available items the user can toggle into their
 * persisted toolbelt. Toggling here flows through the same AppProvider
 * setters as the Capabilities tab, so the two stay in sync. Connecting a
 * server from Plan → Connectors turns it on automatically; this menu is
 * how you turn one back off without disconnecting. Selections persist
 * per-user until changed.
 */
export function CapabilityMenu({ onManage, onClose }: CapabilityMenuProps) {
  const {
    skillRegistry,
    skillsVersion,
    enabledSkillNames,
    enableSkill,
    disableSkill,
    mcp,
    activeConnectorNames,
    enableConnector,
    disableConnector,
  } = useApp();

  // Installed, user-facing skills (core skills are always-on and hidden).
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    skillRegistry
      .list()
      .then((list) => {
        if (!cancelled) setSkills(list.filter((s) => !isCoreSkill(s.name)));
      })
      .catch(() => {
        // ignore — the section just renders its empty hint.
      });
    return () => {
      cancelled = true;
    };
  }, [skillRegistry, skillsVersion]);

  // Connected MCP servers and their live status.
  const [statuses, setStatuses] = useState<McpServerStatus[]>(() => mcp.getStatuses());
  useEffect(() => mcp.subscribe(setStatuses), [mcp]);

  return (
    // Deliberately NOT role="menu". A menu requires menuitem-family
    // children as direct descendants and a roving-focus keyboard model;
    // this is a popover of independent toggles that the user tabs through,
    // so menu semantics both failed automated ARIA checks (section/ul/li
    // sat between the menu and its items) and described the wrong
    // interaction. A labelled group matches what this actually is.
    <div className="capability-menu" role="group" aria-label="Connectors and skills">
      <CapabilityGroup
        title="Connectors"
        emptyHint="No connectors yet. Add one in Manage."
        onManage={() => {
          onClose();
          onManage("connectors");
        }}
        items={statuses.map((s) => ({
          key: s.config.id,
          name: s.config.name,
          meta: connectorMeta(s),
          active: activeConnectorNames.has(s.config.name),
          toggle: () =>
            activeConnectorNames.has(s.config.name)
              ? disableConnector(s.config.name)
              : enableConnector(s.config.name),
        }))}
      />
      <CapabilityGroup
        title="Skills"
        emptyHint="No skills installed. Add one in Manage."
        onManage={() => {
          onClose();
          onManage("skills");
        }}
        items={skills.map((s) => ({
          key: s.name,
          name: s.name,
          meta: s.description,
          active: enabledSkillNames.has(s.name),
          toggle: () =>
            enabledSkillNames.has(s.name) ? disableSkill(s.name) : enableSkill(s.name),
        }))}
      />
    </div>
  );
}

interface CapabilityRow {
  key: string;
  name: string;
  meta?: string;
  active: boolean;
  toggle: () => void;
}

function CapabilityGroup({
  title,
  emptyHint,
  onManage,
  items,
}: {
  title: string;
  emptyHint: string;
  onManage: () => void;
  items: CapabilityRow[];
}) {
  return (
    <section className="capability-menu__group" role="group" aria-label={title}>
      <header className="capability-menu__group-header">
        <span className="capability-menu__group-title">{title}</span>
        <button
          type="button"
          className="capability-menu__manage"
          // Two "Manage →" buttons render in this popover; without a
          // distinguishing name a screen-reader user hears the same label
          // twice with no way to tell which section each belongs to.
          aria-label={`Manage ${title.toLowerCase()}`}
          onClick={onManage}
        >
          Manage →
        </button>
      </header>
      {items.length === 0 ? (
        <p className="capability-menu__empty">{emptyHint}</p>
      ) : (
        <ul className="capability-menu__list">
          {items.map((it) => (
            <li key={it.key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={it.active}
                className={`capability-menu__item${it.active ? " is-active" : ""}`}
                // Click (not mouseDown) keeps it keyboard-operable; the popover
                // stays open so the user can toggle several in one go (the
                // outside-click guard ignores clicks within the anchor).
                onClick={it.toggle}
              >
                <span className="capability-menu__check" aria-hidden="true">
                  {it.active ? <CheckIcon /> : null}
                </span>
                <span className="capability-menu__item-text">
                  <span className="capability-menu__item-name">{it.name}</span>
                  {it.meta && <span className="capability-menu__item-meta">{it.meta}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Short connection-health note shown under a connector's name; nothing once
 * it's connected (the check already shows the user's on/off intent). */
function connectorMeta(status: McpServerStatus): string | undefined {
  switch (status.state.status) {
    case "connected":
      return undefined;
    case "connecting":
      return "connecting…";
    case "error":
      return "not connected";
  }
}

function CheckIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

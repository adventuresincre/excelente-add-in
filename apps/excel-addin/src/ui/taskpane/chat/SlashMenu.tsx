import type { SkillSummary } from "../../../core/skills";
import type { SlashCommand } from "../../../core/commands";

export type SlashMenuItem =
  | { kind: "command"; command: SlashCommand }
  | { kind: "skill"; summary: SkillSummary; enabled: boolean };

/**
 * Discriminator stable across renders — used as React keys and as the
 * argument to the parent's onSelect callback so the dispatcher knows
 * whether to fire a command handler or enable a skill.
 */
export function slashMenuItemKey(item: SlashMenuItem): string {
  return item.kind === "command" ? `cmd:${item.command.name}` : `skill:${item.summary.name}`;
}

interface SlashMenuProps {
  query: string;
  items: SlashMenuItem[];
  activeIdx: number;
  onSelect: (item: SlashMenuItem) => void;
  onHover: (idx: number) => void;
}

/**
 * Floating list anchored above the composer textarea. The Composer owns
 * keyboard handling (arrow keys, Enter, Tab, Escape); this component is a
 * presentational view of the filtered list plus mouse affordances.
 */
export function SlashMenu({ query, items, activeIdx, onSelect, onHover }: SlashMenuProps) {
  const commandCount = items.filter((i) => i.kind === "command").length;
  const skillCount = items.length - commandCount;
  return (
    <div className="slash-menu">
      <div className="slash-menu__header">
        <span className="slash-menu__heading">
          {commandCount > 0 && skillCount > 0
            ? "Commands & skills"
            : commandCount > 0
              ? "Commands"
              : "Skills"}
        </span>
        <span className="slash-menu__hint">↑↓ to navigate · Enter to pick</span>
      </div>
      {items.length === 0 ? (
        <div className="slash-menu__empty">
          {query ? `No command or skill matches “${query}”.` : "Nothing installed."}
        </div>
      ) : (
        // The listbox owns ONLY option children — a header or a wrapping
        // <li> between listbox and option breaks the required
        // parent/child relationship and fails automated ARIA checks. The
        // ul/li remain for styling with role="presentation" so they are
        // dropped from the accessibility tree.
        <ul
          className="slash-menu__list"
          id="slash-menu-list"
          role="listbox"
          aria-label="Slash commands and skills"
        >
          {items.map((item, i) => (
            <li key={slashMenuItemKey(item)} role="presentation">
              <button
                type="button"
                role="option"
                id={`slash-opt-${i}`}
                // The combobox (the composer textarea) owns the single tab
                // stop; options are reached with arrow keys via
                // aria-activedescendant, not by tabbing.
                tabIndex={-1}
                aria-selected={i === activeIdx}
                className={`slash-menu__item${i === activeIdx ? " is-active" : ""}${
                  item.kind === "skill" && item.enabled ? " is-enabled" : ""
                } slash-menu__item--${item.kind}`}
                // onMouseDown so it fires before the textarea blurs.
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelect(item);
                }}
                // Keyboard activation: onMouseDown alone left an option
                // that could be focused but not operated.
                onClick={() => onSelect(item)}
                onMouseEnter={() => onHover(i)}
              >
                {item.kind === "command" ? (
                  <>
                    <span className="slash-menu__item-row">
                      <span className="slash-menu__item-name">/{item.command.name}</span>
                      <span className="slash-menu__item-source">command</span>
                    </span>
                    <span className="slash-menu__item-desc">{item.command.description}</span>
                  </>
                ) : (
                  <>
                    <span className="slash-menu__item-row">
                      <span className="slash-menu__item-name">/{item.summary.name}</span>
                      <span className="slash-menu__item-source">{item.summary.sourceId}</span>
                      {item.enabled && <span className="slash-menu__item-enabled">enabled</span>}
                    </span>
                    <span className="slash-menu__item-desc">{item.summary.description}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

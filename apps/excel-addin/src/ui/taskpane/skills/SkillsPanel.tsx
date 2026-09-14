import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { isCoreSkill, SkillZipError, USER_SOURCE_ID } from "../../../core/skills";
import type { Skill, SkillSummary } from "../../../core/skills";
import { useApp } from "../AppProvider";
import { ConfirmButton } from "../ConfirmButton";
import "./skills.css";

const SKILL_FILENAME = "SKILL.md";

export function SkillsPanel() {
  const {
    skillRegistry,
    skillsVersion,
    enabledSkillNames,
    enableSkill,
    disableSkill,
    installSkill,
    uninstallSkill,
  } = useApp();

  const [list, setList] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [installNotice, setInstallNotice] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const dragDepthRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    skillRegistry
      .list()
      .then((skills) => {
        if (cancelled) return;
        // Core skills are bundled with the add-in and managed by us — they
        // don't appear in the Skills tab. The agent still discovers them
        // via find_skill / load_skill and we summary-inject them into the
        // system prompt unconditionally (see useAgentStream).
        setList(skills.filter((s) => !isCoreSkill(s.name)));
        setError(null);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillRegistry, skillsVersion]);

  const handleZip = useCallback(
    async (file: File) => {
      setInstallError(null);
      setInstallNotice(null);
      setInstalling(true);
      try {
        const result = await installSkill(file);
        setInstallNotice(
          result.replaced ? `Replaced "${result.name}".` : `Installed "${result.name}".`
        );
      } catch (e) {
        if (e instanceof SkillZipError) {
          setInstallError(e.message);
        } else {
          setInstallError(`Install failed: ${(e as Error).message}`);
        }
      } finally {
        setInstalling(false);
      }
    },
    [installSkill]
  );

  const handleFiles = useCallback(
    async (files: FileList | File[] | null | undefined) => {
      if (!files) return;
      for (const f of Array.from(files)) {
        if (!isSupportedSkillFile(f)) {
          setInstallError(
            `"${f.name}" isn't a supported format. Upload a .zip, .skill, or .md file.`
          );
          continue;
        }
        await handleZip(f);
      }
    },
    [handleZip]
  );

  const onDragEnter = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDragOver(true);
  }, []);

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      dragDepthRef.current = 0;
      setDragOver(false);
      const files = e.dataTransfer.files;
      if (!files || files.length === 0) return;
      e.preventDefault();
      void handleFiles(files);
    },
    [handleFiles]
  );

  return (
    <div
      className={`skills-panel${dragOver ? " skills-panel--drag-over" : ""}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragOver && (
        <div className="skills-panel__drop-overlay" aria-hidden="true">
          <div className="skills-panel__drop-overlay-text">
            Drop .zip, .skill, or .md to install
          </div>
        </div>
      )}

      <header className="skills-panel__header">
        <h2>
          <em className="accent">Skills</em> give the agent a playbook.
        </h2>
        <p>
          Activate an agent skill to give the AI step-by-step guidance for a specific task.
        </p>
        <div className="skills-panel__actions">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,.skill,.md,application/zip,application/x-zip-compressed,text/markdown,text/plain"
            multiple
            hidden
            onChange={(e) => {
              void handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            className="btn-secondary skills-panel__upload"
            onClick={() => fileInputRef.current?.click()}
            disabled={installing}
            title="Upload an Open Agent Skill (.zip, .skill, or .md)"
          >
            {installing ? "Installing…" : "Upload skill (.zip / .skill / .md)"}
          </button>
          <span className="skills-panel__hint">or drop a .zip / .skill / .md on this panel</span>
        </div>
      </header>

      {installError && (
        <div className="skills-panel__install-error" role="alert">
          <span>{installError}</span>
          <button
            type="button"
            className="skills-panel__chip-dismiss"
            onClick={() => setInstallError(null)}
            aria-label="Dismiss install error"
          >
            ✕
          </button>
        </div>
      )}
      {installNotice && (
        <div className="skills-panel__install-notice" role="status">
          <span>{installNotice}</span>
          <button
            type="button"
            className="skills-panel__chip-dismiss"
            onClick={() => setInstallNotice(null)}
            aria-label="Dismiss install notice"
          >
            ✕
          </button>
        </div>
      )}

      {loading && <div className="skills-panel__placeholder">Loading skills…</div>}
      {error && <div className="skills-panel__error" role="alert">Failed to load: {error}</div>}
      {!loading && !error && list.length === 0 && (
        <div className="skills-panel__placeholder">No skills installed.</div>
      )}

      <ul className="skills-list">
        {list.map((summary) => (
          <SkillRow
            key={summary.name}
            summary={summary}
            enabled={enabledSkillNames.has(summary.name)}
            onToggle={() =>
              enabledSkillNames.has(summary.name)
                ? disableSkill(summary.name)
                : enableSkill(summary.name)
            }
            onUninstall={
              summary.sourceId === USER_SOURCE_ID
                ? () => void uninstallSkill(summary.name)
                : undefined
            }
          />
        ))}
      </ul>
    </div>
  );
}

function isSupportedSkillFile(file: File): boolean {
  // Extension-first detection — covers every case we actually care about
  // (.zip, .skill, .md). Browsers fill `file.type` inconsistently for
  // user-renamed extensions, so MIME is a soft secondary check.
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip") || name.endsWith(".skill") || name.endsWith(".md")) {
    return true;
  }
  const t = file.type.toLowerCase();
  return (
    t === "application/zip" ||
    t === "application/x-zip-compressed" ||
    t === "text/markdown" ||
    t === "text/plain" // some systems serve .md as text/plain
  );
}

interface SkillRowProps {
  summary: SkillSummary;
  enabled: boolean;
  onToggle: () => void;
  /** When set, a per-row Uninstall affordance is rendered. */
  onUninstall?: () => void;
}

function SkillRow({ summary, enabled, onToggle, onUninstall }: SkillRowProps) {
  const { skillRegistry } = useApp();
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState<Skill | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

  function handleExpand() {
    setExpanded((v) => !v);
    if (!full && !loadingBody) {
      setLoadingBody(true);
      skillRegistry
        .load(summary.name)
        .then(setFull)
        .catch((e: unknown) =>
          setFull({ summary, body: `Failed to load: ${e}`, resources: new Map() })
        )
        .finally(() => setLoadingBody(false));
    }
  }

  return (
    <li className={`skill-row${enabled ? " is-enabled" : ""}${expanded ? " is-expanded" : ""}`}>
      <div className="skill-row__main">
        <label className="skill-row__toggle" title={summary.description}>
          <input type="checkbox" checked={enabled} onChange={onToggle} />
          <span className="skill-row__name">{summary.name}</span>
        </label>
        <button
          type="button"
          className="skill-row__expand"
          aria-expanded={expanded}
          aria-label={expanded ? "Hide details" : "Show details"}
          onClick={handleExpand}
          title={expanded ? "Hide details" : "Show details"}
        >
          {expanded ? "Hide" : "Show"}
        </button>
        {onUninstall && (
          <ConfirmButton
            className="skill-row__uninstall"
            question={`Uninstall "${summary.name}"?`}
            confirmLabel="Uninstall"
            onConfirm={onUninstall}
            title={`Uninstall ${summary.name}`}
            aria-label={`Uninstall ${summary.name}`}
          >
            ✕
          </ConfirmButton>
        )}
      </div>
      {expanded && (
        <div className="skill-row__details">
          <p className="skill-row__description">{summary.description}</p>
          {summary.whenToUse && <p className="skill-row__when">When: {summary.whenToUse}</p>}
          <div className="skill-row__meta">
            {summary.author && <span>{summary.author}</span>}
            {summary.version && <span>v{summary.version}</span>}
            <span className="skill-row__source">{summary.sourceId}</span>
          </div>
          <div className="skill-row__body">
            {loadingBody && <div className="skill-row__loading">Loading body…</div>}
            {!loadingBody && full && <SkillFileTree skill={full} />}
          </div>
        </div>
      )}
    </li>
  );
}

interface SkillFileTreeProps {
  skill: Skill;
}

/**
 * File tree for an expanded skill. Lists SKILL.md plus every resource the
 * skill ships, lets the user click any file to view its contents.
 */
function SkillFileTree({ skill }: SkillFileTreeProps) {
  const files = useMemo(() => {
    const out: { name: string; content: string }[] = [
      { name: SKILL_FILENAME, content: skill.body },
    ];
    const keys = Array.from(skill.resources.keys()).sort((a, b) => a.localeCompare(b));
    for (const k of keys) {
      out.push({ name: k, content: skill.resources.get(k) ?? "" });
    }
    return out;
  }, [skill]);

  const [activeIdx, setActiveIdx] = useState(0);
  const active = files[activeIdx] ?? files[0];

  return (
    <div className="skill-tree" role="tablist" aria-label="Skill files">
      {/* role="presentation" on the ul/li: a tablist requires tab children
          as direct descendants, and the wrapping list elements otherwise
          break that relationship. They stay for styling only. */}
      <ul className="skill-tree__list" role="presentation">
        {files.map((f, i) => (
          <li key={f.name} role="presentation">
            <button
              type="button"
              role="tab"
              aria-selected={i === activeIdx}
              className={`skill-tree__file${i === activeIdx ? " is-active" : ""}`}
              onClick={() => setActiveIdx(i)}
              title={f.name}
            >
              <span className="skill-tree__icon" aria-hidden="true">
                {i === 0 ? "📘" : "📄"}
              </span>
              <span className="skill-tree__name">{f.name}</span>
              <span className="skill-tree__size">{formatSize(f.content.length)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="skill-tree__viewer" role="tabpanel" aria-label={active?.name}>
        <div className="skill-tree__viewer-header">
          <span className="skill-tree__viewer-name">{active?.name}</span>
        </div>
        <pre className="skill-tree__viewer-body">{active?.content ?? ""}</pre>
      </div>
    </div>
  );
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars}B`;
  return `${(chars / 1024).toFixed(1)}KB`;
}

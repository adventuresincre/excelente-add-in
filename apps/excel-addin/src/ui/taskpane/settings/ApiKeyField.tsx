import { useState, type ReactNode } from "react";

export interface ApiKeyFieldProps {
  /** Currently stored key, or null if none. */
  storedKey: string | null;
  /** Save and persist. */
  onSave: (key: string) => Promise<void>;
  /** Clear from storage. */
  onClear: () => Promise<void>;
  /** Replaces the default empty-state hint (e.g. when A.CRE Free is selected). */
  emptyHint?: ReactNode;
}

export function ApiKeyField({ storedKey, onSave, onClear, emptyHint }: ApiKeyFieldProps) {
  const [draft, setDraft] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSave() {
    setError(null);
    setSaved(false);
    if (!draft.trim()) {
      setError("API key cannot be empty");
      return;
    }
    setBusy(true);
    try {
      await onSave(draft.trim());
      setDraft("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setError(null);
    setSaved(false);
    setBusy(true);
    try {
      await onClear();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="api-key-field">
      {storedKey ? (
        <div className="api-key-field__stored">
          <span className="api-key-field__label">Saved key:</span>
          <code className="api-key-field__mask">{maskKey(storedKey, show)}</code>
          <button
            type="button"
            className="btn-secondary"
            // "Show"/"Hide" alone is ambiguous out of context; name what
            // it acts on and expose the toggle state.
            aria-label={show ? "Hide API key" : "Show API key"}
            aria-pressed={show}
            onClick={() => setShow((v) => !v)}
          >
            {show ? "Hide" : "Show"}
          </button>
          <button type="button" className="btn-secondary" onClick={handleClear} disabled={busy}>
            Clear
          </button>
        </div>
      ) : (
        <p className="api-key-field__hint">
          {emptyHint ?? (
            <>
              No API key saved. Get one at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                openrouter.ai/keys
              </a>
              .
            </>
          )}
        </p>
      )}

      <div className="api-key-field__editor">
        <input
          type={show ? "text" : "password"}
          className="api-key-field__input"
          // Placeholder is not a name: it disappears the moment the user
          // types, leaving the field unlabelled.
          aria-label="OpenRouter API key"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "api-key-error" : undefined}
          placeholder={storedKey ? "Replace key…" : "sk-or-…"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
          autoComplete="off"
        />
        <button
          type="button"
          className="btn-primary"
          onClick={handleSave}
          disabled={busy || !draft}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <div className="api-key-field__error" id="api-key-error" role="alert">
          {error}
        </div>
      )}
      {saved && !error && (
        <div className="api-key-field__saved" role="status">
          Saved.
        </div>
      )}
    </div>
  );
}

function maskKey(key: string, show: boolean): string {
  if (show) return key;
  if (key.length <= 8) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

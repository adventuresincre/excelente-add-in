import { useEffect, useState } from "react";
import { useApp } from "../AppProvider";
import { AuthClientError } from "../../../core/auth";
import type { Session } from "../../../core/auth";
import "./auth.css";

export interface AuthDialogProps {
  /** Why we're asking — shown under the title (e.g. the preset being connected). */
  reason?: string;
  /** Called after the session is verified AND persisted. */
  onAuthenticated: (session: Session) => void | Promise<void>;
  onCancel: () => void;
}

type Step = "email" | "code";

/**
 * A.CRE member sign-in, as a full-pane overlay: enter your member email,
 * we send a one-time code, enter the code, done. On success the session is
 * persisted via `completeSignIn` (so member-token MCP servers and the relay
 * pick it up immediately) before `onAuthenticated` fires.
 */
export function AuthDialog({ reason, onAuthenticated, onCancel }: AuthDialogProps) {
  const { authClient, sessionStore, completeSignIn } = useApp();

  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pre-fill the last-known member email (survives sign-out by design).
  useEffect(() => {
    let cancelled = false;
    void sessionStore.getEmailHint().then((hint) => {
      if (!cancelled && hint) setEmail((prev) => prev || hint);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionStore]);

  const emailLooksValid = /\S+@\S+\.\S+/.test(email);

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const { requestId: id } = await authClient.requestCode(email.trim());
      setRequestId(id);
      setCode("");
      setStep("code");
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (!requestId) return;
    setBusy(true);
    setError(null);
    try {
      const session = await authClient.verifyCode({
        requestId,
        email: email.trim(),
        code: code.trim(),
      });
      await completeSignIn(session);
      await onAuthenticated(session);
    } catch (e) {
      setError(messageFor(e));
      setBusy(false);
    }
  }

  return (
    <div
      className="auth-dialog__overlay"
      role="dialog"
      aria-modal="true"
      aria-label="A.CRE sign in"
    >
      <div className="auth-dialog">
        <button
          type="button"
          className="auth-dialog__close"
          onClick={onCancel}
          aria-label="Cancel sign in"
          disabled={busy}
        >
          ✕
        </button>

        <h2 className="auth-dialog__title">
          Sign in to <em className="accent">A.CRE</em>
        </h2>
        {reason && <p className="auth-dialog__reason">{reason}</p>}

        {step === "email" ? (
          <form
            className="auth-dialog__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (emailLooksValid && !busy) void sendCode();
            }}
          >
            <label className="auth-dialog__field">
              <span className="auth-dialog__label">Member email</span>
              <input
                type="email"
                className="auth-dialog__input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                disabled={busy}
                spellCheck={false}
              />
            </label>
            <button
              type="submit"
              className="auth-dialog__submit"
              disabled={!emailLooksValid || busy}
            >
              {busy ? "Sending…" : "Email me a code"}
            </button>
          </form>
        ) : (
          <form
            className="auth-dialog__form"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim() && !busy) void verify();
            }}
          >
            <p className="auth-dialog__sent">
              We emailed a one-time code to <strong>{email.trim()}</strong>.
            </p>
            <label className="auth-dialog__field">
              <span className="auth-dialog__label">Code</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                className="auth-dialog__input auth-dialog__input--code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                autoFocus
                disabled={busy}
                spellCheck={false}
              />
            </label>
            <button type="submit" className="auth-dialog__submit" disabled={!code.trim() || busy}>
              {busy ? "Verifying…" : "Verify & sign in"}
            </button>
            <div className="auth-dialog__links">
              <button
                type="button"
                className="auth-dialog__link"
                onClick={() => void sendCode()}
                disabled={busy}
              >
                Resend code
              </button>
              <button
                type="button"
                className="auth-dialog__link"
                onClick={() => {
                  setStep("email");
                  setError(null);
                }}
                disabled={busy}
              >
                Use a different email
              </button>
            </div>
          </form>
        )}

        {error && (
          <p className="auth-dialog__error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function messageFor(e: unknown): string {
  if (e instanceof AuthClientError) return e.message;
  return `Sign-in failed: ${(e as Error).message}`;
}

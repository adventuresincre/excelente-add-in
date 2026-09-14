import type { AuthWindowResult } from "./oauth";

/**
 * Opens an OAuth authorization page inside the add-in via the Office
 * Dialog API — the sanctioned way to run third-party sign-in from a task
 * pane (a popup would be blocked, and a regular browser tab can't hand the
 * result back).
 *
 * Office requires the dialog's INITIAL url to be same-origin with the
 * add-in, so we open `auth-callback.html?authorize=<url>`, which
 * immediately forwards to the authorization page (its domain must be in
 * the manifest's AppDomains). When the provider redirects back to
 * `auth-callback.html` with `?code&state`, the page calls
 * `Office.context.ui.messageParent` and we resolve.
 */

/** The redirect URI registered with the authorization server. */
export function oauthRedirectUri(): string {
  return `${window.location.origin}/auth-callback.html`;
}

/**
 * Whether the Office Dialog API exists in this host. Callers should check
 * this BEFORE starting an OAuth flow — discovery + dynamic client
 * registration create state on the remote auth server, and doing that
 * work only to find the sign-in window can't open orphans a client
 * registration per attempt.
 */
export function isOfficeDialogAvailable(): boolean {
  return typeof Office !== "undefined" && Boolean(Office.context?.ui?.displayDialogAsync);
}

/**
 * On Office on the web, `promptBeforeOpen: false` means a pop-up blocker
 * can silently prevent the dialog from opening — no callback fires at all.
 * If the open callback hasn't run within this window, settle with a
 * popup-blocker hint instead of leaving the Connect button hung forever.
 * (Desktop opens a native dialog; the callback fires almost immediately.)
 */
const DIALOG_OPEN_TIMEOUT_MS = 15_000;

export function openAuthWindowViaOfficeDialog(authorizationUrl: string): Promise<AuthWindowResult> {
  if (!isOfficeDialogAvailable()) {
    return Promise.resolve({
      error: "dialog_unavailable",
      errorDescription:
        "Sign-in windows aren't available here — open Excelente inside Excel and try again.",
    });
  }
  const startUrl = `${oauthRedirectUri()}?authorize=${encodeURIComponent(authorizationUrl)}`;

  return new Promise<AuthWindowResult>((resolve) => {
    const openTimeout = setTimeout(() => {
      resolve({
        error: "dialog_blocked",
        errorDescription:
          "The sign-in window never opened — your browser's pop-up blocker may have " +
          "stopped it. Allow pop-ups for this page and try again.",
      });
    }, DIALOG_OPEN_TIMEOUT_MS);

    Office.context.ui.displayDialogAsync(
      startUrl,
      { height: 75, width: 40, promptBeforeOpen: false },
      (asyncResult) => {
        clearTimeout(openTimeout);
        if (asyncResult.status === Office.AsyncResultStatus.Failed) {
          resolve({
            error: "dialog_failed",
            errorDescription:
              asyncResult.error?.message ?? "The sign-in window could not be opened.",
          });
          return;
        }
        const dialog = asyncResult.value;
        let settled = false;
        const settle = (result: AuthWindowResult) => {
          if (settled) return;
          settled = true;
          try {
            dialog.close();
          } catch {
            // Already closed — nothing to clean up.
          }
          resolve(result);
        };

        dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg) => {
          const message = (arg as { message?: string }).message;
          if (!message) return;
          try {
            settle(JSON.parse(message) as AuthWindowResult);
          } catch {
            settle({
              error: "bad_callback",
              errorDescription: "The sign-in window returned an unreadable response.",
            });
          }
        });

        dialog.addEventHandler(Office.EventType.DialogEventReceived, () => {
          // Covers the user closing the window (12006) and navigation
          // failures (12002/12003, e.g. a domain missing from AppDomains).
          settle({
            error: "window_closed",
            errorDescription: "The sign-in window was closed before finishing.",
          });
        });
      }
    );
  });
}

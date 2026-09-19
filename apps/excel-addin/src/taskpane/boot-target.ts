/**
 * Where the pane is running, and therefore what to render.
 *
 * `taskpane.html` is a public URL. It has to be — Office fetches it over the
 * internet, and the manifest names it, so it cannot be moved or protected
 * without a Partner Center resubmission. That means anyone who types the URL
 * into a browser reaches the same page Excel does.
 *
 * Until now they got a working add-in. `boot()` asked Office for the host and,
 * finding none, mounted anyway with in-memory storage — the browser-preview
 * path that exists so `npm run dev` is useful. Deployed, that path handed a
 * stranger a working agent and, with a hosted tier selected, spend on the
 * host's OpenRouter key.
 *
 * The rule below keeps the preview where it belongs (a dev server on this
 * machine) and shows everyone else a page pointing at the real install.
 *
 * **This must never refuse a genuine Excel host.** It does not gate on user
 * agent, framing, referrer or `Sec-Fetch-*` — none of which distinguish the
 * three hosts from a browser. Excel on the web frames the pane; Excel on
 * Windows loads it as a top-level document in a WebView2; Excel for Mac uses a
 * WKWebView that sends no `Sec-Fetch` headers at all. The only signal common
 * to all three is Office.js itself reporting a host, which is the same signal
 * every Office add-in boots on.
 */
export type BootTarget = "excel" | "preview" | "blocked";

/** Hostnames that mean "a dev server on this machine", never a deployment. */
function isLoopback(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h === "127.0.0.1" ||
    h === "0.0.0.0" ||
    h === "::1"
  );
}

/**
 * @param officeHostIsExcel Office.js reported `Office.HostType.Excel`. True for
 *   Excel on Windows, Excel for Mac and Excel on the web alike.
 * @param hostname `location.hostname` of the page.
 */
export function decideBootTarget(officeHostIsExcel: boolean, hostname: string): BootTarget {
  // An Office host is dispositive and is checked first, so a deployment can
  // never be blocked for a real user no matter what the hostname is.
  if (officeHostIsExcel) return "excel";
  return isLoopback(hostname) ? "preview" : "blocked";
}

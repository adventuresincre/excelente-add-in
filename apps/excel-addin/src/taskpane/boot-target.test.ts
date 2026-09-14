import { describe, expect, it } from "vitest";
import { decideBootTarget } from "./boot-target";

describe("decideBootTarget", () => {
  // The whole point of the gate is that it cannot lock a real user out, so
  // this is the case that matters most. Office.js reports HostType.Excel on
  // Windows (WebView2), Mac (WKWebView) and the web (iframe) alike.
  it("mounts the app for an Office host on every origin", () => {
    for (const hostname of [
      "excelente.aiedge.ac",
      "dev.excelente.aiedge.ac",
      "localhost",
      "127.0.0.1",
      "",
    ]) {
      expect(decideBootTarget(true, hostname)).toBe("excel");
    }
  });

  it("keeps the browser preview on a dev server", () => {
    expect(decideBootTarget(false, "localhost")).toBe("preview");
    expect(decideBootTarget(false, "127.0.0.1")).toBe("preview");
    expect(decideBootTarget(false, "0.0.0.0")).toBe("preview");
    expect(decideBootTarget(false, "::1")).toBe("preview");
    expect(decideBootTarget(false, "[::1]")).toBe("preview");
    expect(decideBootTarget(false, "app.localhost")).toBe("preview");
    expect(decideBootTarget(false, "LOCALHOST")).toBe("preview");
  });

  it("blocks a browser on a deployed origin — both instances", () => {
    expect(decideBootTarget(false, "excelente.aiedge.ac")).toBe("blocked");
    expect(decideBootTarget(false, "dev.excelente.aiedge.ac")).toBe("blocked");
  });

  // A look-alike host must not be mistaken for the dev server.
  it("does not treat a hostname that merely contains localhost as loopback", () => {
    expect(decideBootTarget(false, "localhost.example.com")).toBe("blocked");
    expect(decideBootTarget(false, "notlocalhost")).toBe("blocked");
    expect(decideBootTarget(false, "127.0.0.1.example.com")).toBe("blocked");
  });
});

import React from "react";
import { createRoot } from "react-dom/client";
import { AppProvider } from "../ui/taskpane/AppProvider";
import { App } from "./App";
import { decideBootTarget } from "./boot-target";
import { inMemoryDataSource } from "../core/context";
import { createInMemorySkillStore } from "../core/skills";
import {
  createInMemoryConversationStore,
  createInMemoryMcpServerStore,
  inMemoryBackend,
} from "../core/storage";

/**
 * Browser preview (Vite at https://localhost:3000, not Excel) must never
 * touch OfficeRuntime.storage or IndexedDB for the OpenRouter key. The
 * in-memory backend lives in this page's JS heap and dies on refresh —
 * it is not written to disk, localStorage, or the repo.
 *
 * Inside Excel the existing OfficeRuntime.storage backend is used (sandboxed
 * per add-in, still plaintext — see core/storage/README.md).
 */
function previewProps() {
  return {
    storageBackend: inMemoryBackend(),
    ds: inMemoryDataSource({ sheets: [{ name: "Sheet1" }] }),
    conversationStore: createInMemoryConversationStore(),
    skillStore: createInMemorySkillStore(),
    mcpServerStore: createInMemoryMcpServerStore(),
    workbookId: "<browser-preview>",
  };
}

function mount(inExcel: boolean) {
  const container = document.getElementById("app");
  if (!container) {
    throw new Error("Mount point #app not found");
  }
  createRoot(container).render(
    <React.StrictMode>
      <AppProvider {...(inExcel ? {} : previewProps())}>
        <App />
      </AppProvider>
    </React.StrictMode>
  );
}

/**
 * Shown instead of the app when someone opens the pane's URL in a browser on
 * a deployed origin. Not a dead end: it names the two ways to actually get
 * the add-in, and tells anyone who is genuinely inside Excel what to do,
 * because the one way to land here by mistake is Office.js failing to load.
 */
function renderOutsideExcelNotice() {
  const container = document.getElementById("app");
  if (!container) return;
  container.innerHTML = `
    <div class="outside-excel">
      <img class="outside-excel__mark" src="/assets/icon-64.png" alt="" width="40" height="40" />
      <h1 class="outside-excel__title">Excelente runs inside Excel.</h1>
      <p class="outside-excel__body">
        This page is the add-in's task pane. It needs a workbook around it, so
        there is nothing to use here.
      </p>
      <p class="outside-excel__body">
        <a class="outside-excel__link" href="/">Go to the Excelente home page</a>
      </p>
      <p class="outside-excel__note">
        If you are seeing this inside Excel, close the task pane and reopen it.
        That usually means Office scripts were slow to load.
      </p>
    </div>`;
}

function boot() {
  if (typeof Office !== "undefined" && typeof Office.onReady === "function") {
    Office.onReady((info) => {
      const target = decideBootTarget(info.host === Office.HostType.Excel, location.hostname);
      if (target === "blocked") {
        renderOutsideExcelNotice();
        return;
      }
      mount(target === "excel");
    });
    return;
  }
  // Office.js is absent entirely — the CDN script did not load. Inside Excel
  // that is a transient failure, so the notice tells the reader to reopen the
  // pane rather than leaving a blank page.
  if (decideBootTarget(false, location.hostname) === "blocked") {
    renderOutsideExcelNotice();
    return;
  }
  mount(false);
}

boot();

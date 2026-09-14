import { useEffect, useState } from "react";
import type { SelectionInfo } from "../../../core/context";
import { useApp } from "../AppProvider";

/**
 * Live view of the user's Excel selection, for the composer's selection
 * chip. Subscribes through the datasource abstraction (no Office.js here),
 * seeds with the current selection on mount, and debounces the event burst
 * an arrow-key drag produces — each raw event costs an Excel.run round-trip
 * upstream, so we only commit the trailing value.
 */
const DEBOUNCE_MS = 150;

export function useExcelSelection(): SelectionInfo | null {
  const { ds } = useApp();
  const [selection, setSelection] = useState<SelectionInfo | null>(null);

  useEffect(() => {
    let disposed = false;
    let timer: number | null = null;
    let latest: SelectionInfo | null = null;

    // Seed so the chip is right before the first cursor move.
    void ds
      .getSelection()
      .then((sel) => {
        if (!disposed) setSelection(sel);
      })
      .catch(() => {
        /* chip just stays hidden */
      });

    const unsubscribe = ds.onSelectionChanged((sel) => {
      latest = sel;
      if (timer !== null) return; // trailing-edge debounce
      timer = window.setTimeout(() => {
        timer = null;
        if (!disposed) setSelection(latest);
      }, DEBOUNCE_MS);
    });

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, [ds]);

  return selection;
}

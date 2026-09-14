import type { HookContext, HookEvent, HookHandler, HookResult } from "./types";

/**
 * Registry where handlers subscribe to lifecycle events and the
 * orchestrator (or other layers) fire them at the right moments.
 *
 * Single instance per AppProvider; passed into the orchestrator via deps
 * and exposed on `useApp()` for skills / external code that wants to
 * register handlers.
 */
export interface HookRegistry {
  /**
   * Subscribe a handler to an event. Returns an unsubscribe function.
   * Multiple handlers per event are fine — they run in registration order.
   */
  on(event: HookEvent, handler: HookHandler): () => void;
  /**
   * Fire an event. Resolves to the first non-empty veto encountered (for
   * `PreToolUse`), or `{}` if none. Later handlers in the chain are skipped
   * once a veto is set — fail-fast behavior so a single guard rejects the
   * call cleanly without running subsequent handlers that might mutate
   * external state.
   *
   * Thrown errors are converted to `{ veto: error.message }`. Other event
   * types (`SessionStart`, `PostToolUse`) ignore the return value but still
   * await each handler so any side-effects complete before firing
   * progresses.
   */
  fire(ctx: HookContext): Promise<HookResult>;
}

export function createHookRegistry(): HookRegistry {
  const handlers = new Map<HookEvent, HookHandler[]>();

  function getList(event: HookEvent): HookHandler[] {
    let list = handlers.get(event);
    if (!list) {
      list = [];
      handlers.set(event, list);
    }
    return list;
  }

  return {
    on(event, handler) {
      const list = getList(event);
      list.push(handler);
      return () => {
        const idx = list.indexOf(handler);
        if (idx !== -1) list.splice(idx, 1);
      };
    },

    async fire(ctx) {
      const list = handlers.get(ctx.event);
      if (!list || list.length === 0) return {};

      for (const handler of list) {
        let outcome: HookResult | void;
        try {
          outcome = await handler(ctx);
        } catch (e) {
          // Thrown errors are veto-equivalent for PreToolUse and logged-
          // and-continued for observer events. We surface them as veto
          // either way; orchestrator only checks veto on PreToolUse, so
          // observers get a soft failure mode without crashing the run.
          return { veto: (e as Error).message ?? String(e) };
        }
        if (outcome && outcome.veto) {
          return outcome;
        }
      }
      return {};
    },
  };
}

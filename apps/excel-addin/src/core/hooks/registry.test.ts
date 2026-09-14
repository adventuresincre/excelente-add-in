import { describe, expect, it, vi } from "vitest";
import { createHookRegistry } from "./registry";

const preToolCtx = {
  event: "PreToolUse" as const,
  toolName: "write_range",
  input: { sheet: "S", address: "A1" },
  requiredPermission: "Write" as const,
  conversationId: "conv-1",
};

const postToolCtx = {
  event: "PostToolUse" as const,
  toolName: "write_range",
  input: { sheet: "S", address: "A1" },
  result: "ok",
  conversationId: "conv-1",
};

const sessionStartCtx = {
  event: "SessionStart" as const,
  conversationId: "conv-1",
  workbookId: "wb-1",
};

describe("HookRegistry", () => {
  it("fire with no handlers resolves to {}", async () => {
    const reg = createHookRegistry();
    expect(await reg.fire(preToolCtx)).toEqual({});
  });

  it("runs handlers in registration order and returns {} when none veto", async () => {
    const reg = createHookRegistry();
    const calls: string[] = [];
    reg.on("PreToolUse", async () => {
      calls.push("a");
    });
    reg.on("PreToolUse", async () => {
      calls.push("b");
    });

    expect(await reg.fire(preToolCtx)).toEqual({});
    expect(calls).toEqual(["a", "b"]);
  });

  it("PreToolUse: first veto short-circuits subsequent handlers", async () => {
    const reg = createHookRegistry();
    const after = vi.fn();
    reg.on("PreToolUse", async () => ({ veto: "nope" }));
    reg.on("PreToolUse", after);

    expect(await reg.fire(preToolCtx)).toEqual({ veto: "nope" });
    expect(after).not.toHaveBeenCalled();
  });

  it("thrown errors are converted to vetoes with the error message", async () => {
    const reg = createHookRegistry();
    reg.on("PreToolUse", async () => {
      throw new Error("guard exploded");
    });
    expect(await reg.fire(preToolCtx)).toEqual({ veto: "guard exploded" });
  });

  it("unsubscribe removes a handler and only that handler", async () => {
    const reg = createHookRegistry();
    const a = vi.fn();
    const b = vi.fn();
    const offA = reg.on("PreToolUse", a);
    reg.on("PreToolUse", b);

    offA();
    await reg.fire(preToolCtx);

    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledOnce();
  });

  it("handlers scoped per event — firing PreToolUse doesn't call PostToolUse handlers", async () => {
    const reg = createHookRegistry();
    const pre = vi.fn();
    const post = vi.fn();
    reg.on("PreToolUse", pre);
    reg.on("PostToolUse", post);

    await reg.fire(preToolCtx);

    expect(pre).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
  });

  it("awaits every handler so side-effects complete in order (observer pattern)", async () => {
    const reg = createHookRegistry();
    const seen: number[] = [];
    reg.on("PostToolUse", async () => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(1);
    });
    reg.on("PostToolUse", async () => {
      seen.push(2);
    });

    await reg.fire(postToolCtx);
    expect(seen).toEqual([1, 2]);
  });

  it("SessionStart handlers receive the conversation id + workbook id", async () => {
    const reg = createHookRegistry();
    const handler = vi.fn();
    reg.on("SessionStart", handler);

    await reg.fire(sessionStartCtx);
    expect(handler).toHaveBeenCalledWith(sessionStartCtx);
  });
});

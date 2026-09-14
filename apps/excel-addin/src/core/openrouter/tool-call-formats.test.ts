import { describe, expect, it } from "vitest";
import { parseKimiToolCalls } from "./tool-call-formats";

describe("parseKimiToolCalls", () => {
  it("returns [] when content has no Kimi tokens", () => {
    expect(parseKimiToolCalls("")).toEqual([]);
    expect(parseKimiToolCalls("Just text, no tools.")).toEqual([]);
    expect(parseKimiToolCalls('{"foo": "bar"}')).toEqual([]);
  });

  it("parses a single Kimi tool call", () => {
    const content = `Some preamble.
<|tool_calls_section_begin|>
<|tool_call_begin|>functions.read_range:0<|tool_call_argument_begin|>{"address":"A1:B2"}<|tool_call_end|>
<|tool_calls_section_end|>`;
    const calls = parseKimiToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      name: "read_range",
      arguments: '{"address":"A1:B2"}',
    });
    expect(calls[0].id).toMatch(/^kimi_/);
  });

  it("parses multiple tool calls in one response", () => {
    const content = `<|tool_calls_section_begin|>
<|tool_call_begin|>functions.list_sheets:0<|tool_call_argument_begin|>{}<|tool_call_end|>
<|tool_call_begin|>functions.write_range:1<|tool_call_argument_begin|>{"sheet":"S","address":"C3","values":[[1]]}<|tool_call_end|>
<|tool_calls_section_end|>`;
    const calls = parseKimiToolCalls(content);
    expect(calls).toHaveLength(2);
    expect(calls[0].name).toBe("list_sheets");
    expect(calls[0].arguments).toBe("{}");
    expect(calls[1].name).toBe("write_range");
    expect(calls[1].arguments).toContain('"sheet":"S"');
  });

  it("strips the 'functions.' prefix and ':N' index suffix from the name", () => {
    const content = `<|tool_call_begin|>functions.screenshot_range:42<|tool_call_argument_begin|>{"sheetName":"S"}<|tool_call_end|>`;
    expect(parseKimiToolCalls(content)[0].name).toBe("screenshot_range");
  });

  it("recovers from a truncated stream missing the final <|tool_call_end|>", () => {
    const content = `<|tool_call_begin|>functions.inspect_workbook<|tool_call_argument_begin|>{"scope":"workbook"`;
    const calls = parseKimiToolCalls(content);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("inspect_workbook");
    expect(calls[0].arguments).toBe('{"scope":"workbook"');
  });

  it("assigns deterministic incrementing ids so the orchestrator can correlate", () => {
    const content = `<|tool_call_begin|>functions.a<|tool_call_argument_begin|>{}<|tool_call_end|>
<|tool_call_begin|>functions.b<|tool_call_argument_begin|>{}<|tool_call_end|>`;
    const calls = parseKimiToolCalls(content);
    expect(calls[0].id).toBe("kimi_0");
    expect(calls[1].id).toBe("kimi_1");
  });
});

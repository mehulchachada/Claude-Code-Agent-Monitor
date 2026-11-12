/**
 * @file conversation-turns.test.ts
 * @description Verifies the turn model that backs the digest view: turn
 * boundaries, the partial leading turn, stable keys, answer selection,
 * step grouping, tool labels, totals, and filterTurns.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import { groupIntoTurns, makePreview, filterTurns, shortToolName } from "../conversation-turns";
import type { TranscriptMessage } from "../types";
import type { SourcedMessage } from "../conversation-merge";

const ts = "2026-08-01T12:00:00.000Z";
const OPUS = "claude-opus-5-5";

const user = (text: string, extra: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  type: "user",
  sender: "user",
  timestamp: ts,
  content: [{ type: "text", text }],
  ...extra,
});

const assistant = (
  blocks: TranscriptMessage["content"],
  extra: Partial<TranscriptMessage> = {}
): TranscriptMessage => ({
  type: "assistant",
  sender: "assistant",
  model: OPUS,
  timestamp: ts,
  content: blocks,
  ...extra,
});

const toolResult = (id: string, output: string, isError = false): TranscriptMessage => ({
  type: "user",
  sender: "tool",
  timestamp: ts,
  content: [{ type: "tool_result", id, output, ...(isError ? { is_error: true } : {}) }],
});

const subAgent = (
  sourceId: string,
  sourceName: string,
  blocks: TranscriptMessage["content"],
  extra: Partial<TranscriptMessage> = {}
): SourcedMessage => ({
  type: "assistant",
  sender: "assistant",
  model: OPUS,
  timestamp: ts,
  content: blocks,
  source: { id: sourceId, name: sourceName, type: "subagent" },
  ...extra,
});

describe("groupIntoTurns", () => {
  it("groups a prompt with its assistant work and tool results into one turn", () => {
    const messages: TranscriptMessage[] = [
      user("Fix the bug"),
      assistant([
        { type: "thinking", text: "look first" },
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
      ]),
      toolResult("t1", "ok"),
      assistant([{ type: "text", text: "Fixed." }]),
      user("Now ship it"),
      assistant([{ type: "text", text: "Shipped." }]),
    ];
    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(2);
    const first = turns[0]!;
    expect(first.partial).toBe(false);
    expect(first.promptPreview).toBe("Fix the bug");
    expect(first.answerPreview).toBe("Fixed.");
    expect(first.messages).toHaveLength(4);
    expect(first.toolCount).toBe(1);
    expect(first.errorCount).toBe(0);
    expect(first.agentCount).toBe(0);
    expect(first.startedAt).toBe(ts);
    expect(first.endedAt).toBe(ts);
    expect(turns[1]!.promptPreview).toBe("Now ship it");
    expect(turns[1]!.answerPreview).toBe("Shipped.");
  });

  it("does not start a turn at a tool-result-only user message", () => {
    const messages: TranscriptMessage[] = [
      user("Fix the bug"),
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
      toolResult("t1", "ok"),
      assistant([{ type: "text", text: "done" }]),
    ];
    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(1);
    expect(turns[0]!.promptPreview).toBe("Fix the bug");
    expect(turns[0]!.messages).toHaveLength(4);
  });

  it("returns an empty array for an empty message list", () => {
    expect(groupIntoTurns([])).toEqual([]);
  });

  it("collects messages before the first prompt into a partial leading turn", () => {
    const messages: TranscriptMessage[] = [
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
      toolResult("t1", "ok"),
      assistant([{ type: "text", text: "done" }]),
      user("Fix the bug"),
      assistant([{ type: "text", text: "Fixed." }]),
    ];
    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(2);
    const partial = turns[0]!;
    expect(partial.partial).toBe(true);
    expect(partial.prompt).toBeNull();
    expect(partial.promptPreview).toBe("");
    expect(partial.key).toBe("earlier");
    expect(partial.messages).toHaveLength(3);
    expect(turns[1]!.partial).toBe(false);
  });
});

describe("stable keys", () => {
  it("keeps turn keys stable when older messages are prepended", () => {
    const base: TranscriptMessage[] = [
      user("Fix the bug", { id: "p1" }),
      assistant([{ type: "text", text: "Fixed." }]),
      user("Now ship it", { id: "p2" }),
      assistant([{ type: "text", text: "Shipped." }]),
    ];
    const before = groupIntoTurns(base);
    const prepended: TranscriptMessage[] = [
      assistant([{ type: "text", text: "earlier work" }]),
      ...base,
    ];
    const after = groupIntoTurns(prepended);
    expect(after.map((turn) => turn.key)).toEqual(["earlier", before[0]!.key, before[1]!.key]);
    expect(before[0]!.key).toBe("p1");
    expect(before[1]!.key).toBe("p2");
  });

  it("keeps turn keys stable when newer messages are appended", () => {
    const base: TranscriptMessage[] = [
      user("Fix the bug", { id: "p1" }),
      assistant([{ type: "text", text: "Fixed." }]),
    ];
    const before = groupIntoTurns(base);
    const appended: TranscriptMessage[] = [
      ...base,
      user("Now ship it", { id: "p2" }),
      assistant([{ type: "text", text: "Shipped." }]),
    ];
    const after = groupIntoTurns(appended);
    expect(after[0]!.key).toBe(before[0]!.key);
    expect(after[1]!.key).toBe("p2");
  });

  it("suffixes colliding prompt keys", () => {
    const messages: TranscriptMessage[] = [
      user("Same", { id: "dup" }),
      assistant([{ type: "text", text: "one" }]),
      user("Same", { id: "dup" }),
      assistant([{ type: "text", text: "two" }]),
    ];
    const turns = groupIntoTurns(messages);
    expect(turns[0]!.key).toBe("dup");
    expect(turns[1]!.key).toBe("dup-2");
  });
});

describe("answer selection", () => {
  it("uses the last main-agent text, not a sub-agent's line", () => {
    const messages: TranscriptMessage[] = [
      user("Build it"),
      subAgent("sub-1", "researcher", [{ type: "text", text: "I found the docs." }]),
      assistant([{ type: "text", text: "Working on it." }]),
      subAgent("sub-1", "researcher", [{ type: "text", text: "More findings." }]),
      assistant([{ type: "text", text: "Done, here is the result." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.answerPreview).toBe("Done, here is the result.");
    expect(turn.agentCount).toBe(1);
  });

  it("leaves the answer empty when there is no main-agent text", () => {
    const messages: TranscriptMessage[] = [
      user("Build it"),
      subAgent("sub-1", "researcher", [{ type: "text", text: "I found the docs." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.answer).toBeNull();
    expect(turn.answerPreview).toBe("");
  });
});

describe("step grouping", () => {
  it("groups said / tools runs / one agent step per sub-agent", () => {
    const messages: TranscriptMessage[] = [
      user("Fix the bug"),
      assistant([{ type: "text", text: "Reading the file." }]),
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
      toolResult("t1", "ok"),
      assistant([{ type: "tool_use", id: "t2", name: "Bash", input: {} }]),
      assistant([{ type: "text", text: "Now editing." }]),
      assistant([{ type: "tool_use", id: "t3", name: "Edit", input: {} }]),
      toolResult("t3", "ok"),
      assistant([{ type: "text", text: "Fixed." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.steps.map((step) => step.kind)).toEqual(["said", "tools", "said", "tools"]);
    expect(turn.steps[0]!.label).toBe("Reading the file.");
    expect(turn.steps[1]!.label).toBe("Bash ×2");
    expect(turn.steps[2]!.label).toBe("Now editing.");
    expect(turn.steps[3]!.label).toBe("Edit");
    // The answer ("Fixed.") and the prompt are not steps.
    expect(
      turn.steps.every((step) => step.messages.every((m) => m !== turn.prompt && m !== turn.answer))
    ).toBe(true);
  });

  it("keeps one agent step per sub-agent, placed at its first message", () => {
    const messages: TranscriptMessage[] = [
      user("Build it"),
      subAgent("sub-1", "researcher", [{ type: "text", text: "first" }]),
      assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]),
      toolResult("t1", "ok"),
      subAgent("sub-2", "coder", [{ type: "text", text: "hello" }]),
      subAgent("sub-1", "researcher", [{ type: "text", text: "second" }]),
      assistant([{ type: "text", text: "Done." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.steps.map((step) => step.kind)).toEqual(["agent", "tools", "agent"]);
    expect(turn.steps[0]!.label).toBe("researcher");
    expect(turn.steps[0]!.messages).toHaveLength(2);
    expect(turn.steps[1]!.label).toBe("Bash");
    expect(turn.steps[2]!.label).toBe("coder");
    expect(turn.agentCount).toBe(2);
  });

  it("labels a tools step with no tool call as empty (thinking)", () => {
    const messages: TranscriptMessage[] = [
      user("Think"),
      assistant([{ type: "thinking", text: "pondering" }]),
      assistant([{ type: "text", text: "Answer." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.steps).toHaveLength(1);
    expect(turn.steps[0]!.kind).toBe("tools");
    expect(turn.steps[0]!.label).toBe("");
    expect(turn.steps[0]!.toolCount).toBe(0);
  });

  it("counts tools and errors per step and per turn", () => {
    const messages: TranscriptMessage[] = [
      user("Fix the bug"),
      assistant([
        { type: "tool_use", id: "t1", name: "Bash", input: {} },
        { type: "tool_use", id: "t2", name: "Bash", input: {} },
        { type: "tool_use", id: "t3", name: "Edit", input: {} },
      ]),
      toolResult("t1", "ok"),
      toolResult("t2", "bad", true),
      toolResult("t3", "ok"),
      assistant([{ type: "text", text: "Fixed." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.steps).toHaveLength(1);
    expect(turn.steps[0]!.label).toBe("Bash ×2, Edit");
    expect(turn.steps[0]!.toolCount).toBe(3);
    expect(turn.steps[0]!.errorCount).toBe(1);
    expect(turn.toolCount).toBe(3);
    expect(turn.errorCount).toBe(1);
  });
});

describe("filterTurns", () => {
  const messages: TranscriptMessage[] = [
    user("Fix the bug"),
    assistant([{ type: "thinking", text: "look first" }]),
    assistant([{ type: "tool_use", id: "t1", name: "write_file", input: {} }]),
    toolResult("t1", "ok"),
    assistant([{ type: "text", text: "Fixed." }]),
    user("Now ship it"),
    assistant([{ type: "text", text: "Shipped." }]),
  ];
  const turns = groupIntoTurns(messages);

  it("returns all turns for an empty or whitespace query", () => {
    expect(filterTurns(turns, "")).toHaveLength(2);
    expect(filterTurns(turns, "   ")).toHaveLength(2);
  });

  it("matches on prompt text (case-insensitive)", () => {
    const hits = filterTurns(turns, "SHIP");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.promptPreview).toBe("Now ship it");
  });

  it("matches on answer text", () => {
    const hits = filterTurns(turns, "shipped");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.promptPreview).toBe("Now ship it");
  });

  it("matches on tool names inside the turn", () => {
    const hits = filterTurns(turns, "write_file");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.promptPreview).toBe("Fix the bug");
  });

  it("matches on thinking text", () => {
    const hits = filterTurns(turns, "look first");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.promptPreview).toBe("Fix the bug");
  });

  it("returns no turns when nothing matches", () => {
    expect(filterTurns(turns, "zzz-no-such-text")).toHaveLength(0);
  });
});

describe("shortToolName", () => {
  it("returns the last segment of an MCP tool name", () => {
    expect(shortToolName("mcp__ccd_turn__update_plan")).toBe("update_plan");
    expect(shortToolName("mcp__visualize__read_me")).toBe("read_me");
  });

  it("returns plain names and single-segment MCP names unchanged", () => {
    expect(shortToolName("Bash")).toBe("Bash");
    expect(shortToolName("mcp__x")).toBe("mcp__x");
  });
});

describe("tool labels with MCP names", () => {
  it("counts MCP and plain tools by their short names", () => {
    const messages: TranscriptMessage[] = [
      user("Fix the bug"),
      assistant([
        { type: "tool_use", id: "t1", name: "mcp__ccd_turn__update_plan", input: {} },
        { type: "tool_use", id: "t2", name: "mcp__ccd_turn__update_plan", input: {} },
        { type: "tool_use", id: "t3", name: "Bash", input: {} },
        { type: "tool_use", id: "t4", name: "Bash", input: {} },
        { type: "tool_use", id: "t5", name: "Bash", input: {} },
        { type: "tool_use", id: "t6", name: "mcp__visualize__read_me", input: {} },
      ]),
      assistant([{ type: "text", text: "Fixed." }]),
    ];
    const turn = groupIntoTurns(messages)[0]!;
    expect(turn.steps[0]!.label).toBe("update_plan ×2, Bash ×3, read_me");
  });
});

describe("makePreview", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    const long = "a".repeat(300);
    const preview = makePreview(long, 160);
    expect(preview).toHaveLength(160);
    expect(preview.endsWith("…")).toBe(true);
  });

  it("returns short text unchanged", () => {
    expect(makePreview("hello   world")).toBe("hello world");
  });
});

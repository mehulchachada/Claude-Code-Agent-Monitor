/**
 * @file conversation-turns.test.ts
 * @description Verifies the turn-grouping helper that backs the digest view:
 * prompts start new turns, assistant work and tool results stay with the
 * prompt that triggered them, and previews/counters are derived correctly.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import { groupIntoTurns, makePreview, filterTurns } from "../conversation-turns";
import type { TranscriptMessage } from "../types";

const ts = "2026-08-01T12:00:00.000Z";
const OPUS = "claude-opus-5-5";

const messages: TranscriptMessage[] = [
  { type: "user", sender: "user", timestamp: ts, content: [{ type: "text", text: "Fix the bug" }] },
  {
    type: "assistant",
    sender: "assistant",
    model: OPUS,
    timestamp: ts,
    content: [
      { type: "thinking", text: "look first" },
      { type: "text", text: "Reading the file." },
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
      { type: "tool_use", id: "t2", name: "search", input: { pattern: "x" } },
    ],
  },
  {
    type: "user",
    sender: "tool",
    timestamp: ts,
    content: [{ type: "tool_result", id: "t1", output: "ok" }],
  },
  {
    type: "user",
    sender: "tool",
    timestamp: ts,
    content: [{ type: "tool_result", id: "t2", output: "bad regex", is_error: true }],
  },
  {
    type: "user",
    sender: "system",
    timestamp: ts,
    content: [{ type: "text", text: "stdout: done" }],
  },
  {
    type: "assistant",
    sender: "assistant",
    model: OPUS,
    timestamp: ts,
    content: [
      { type: "text", text: "Fixed." },
      { type: "tool_use", id: "t3", name: "write_file", input: { path: "a.ts" } },
    ],
  },
  {
    type: "user",
    sender: "tool",
    timestamp: ts,
    content: [{ type: "tool_result", id: "t3", output: "wrote" }],
  },
  { type: "user", sender: "user", timestamp: ts, content: [{ type: "text", text: "Now ship it" }] },
  {
    type: "assistant",
    sender: "assistant",
    model: OPUS,
    timestamp: ts,
    content: [{ type: "text", text: "Shipped." }],
  },
];

describe("groupIntoTurns", () => {
  it("groups a prompt with its assistant work and tool results into one turn", () => {
    const turns = groupIntoTurns(messages);
    expect(turns).toHaveLength(2);
    const first = turns[0]!;
    expect(first.promptPreview).toBe("Fix the bug");
    expect(first.promptSender).toBe("user");
    expect(first.replyPreview).toBe("Reading the file.");
    expect(first.messages.length).toBe(7);
    expect(first.toolCount).toBe(3);
    expect(first.thinkingCount).toBe(1);
    expect(first.errorCount).toBe(1);
    expect(first.agentCount).toBe(4);
    expect(first.startedAt).toBe(ts);
  });

  it("starts a new turn when a user prompt arrives", () => {
    const turns = groupIntoTurns(messages);
    const second = turns[1]!;
    expect(second.promptPreview).toBe("Now ship it");
    expect(second.replyPreview).toBe("Shipped.");
    expect(second.messages.length).toBe(2);
    expect(second.toolCount).toBe(0);
  });

  it("returns an empty array for an empty message list", () => {
    expect(groupIntoTurns([])).toEqual([]);
  });

  it("does not count a tool-result-only user message as a prompt", () => {
    const only: TranscriptMessage[] = [
      {
        type: "user",
        sender: "tool",
        timestamp: ts,
        content: [{ type: "tool_result", id: "x", output: "ok" }],
      },
      {
        type: "assistant",
        sender: "assistant",
        model: OPUS,
        timestamp: ts,
        content: [{ type: "text", text: "done" }],
      },
    ];
    const turns = groupIntoTurns(only);
    expect(turns).toHaveLength(1);
    const onlyTurn = turns[0]!;
    expect(onlyTurn.promptPreview).toBeNull();
    expect(onlyTurn.replyPreview).toBe("done");
  });
});

describe("filterTurns", () => {
  const turns = groupIntoTurns(messages);

  it("returns all turns for an empty or whitespace query", () => {
    expect(filterTurns(turns, "")).toHaveLength(2);
    expect(filterTurns(turns, "   ")).toHaveLength(2);
  });

  it("matches on prompt text (case-insensitive)", () => {
    expect(filterTurns(turns, "SHIP")).toHaveLength(1);
    expect(filterTurns(turns, "SHIP")[0]!.promptPreview).toBe("Now ship it");
  });

  it("matches on reply text", () => {
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

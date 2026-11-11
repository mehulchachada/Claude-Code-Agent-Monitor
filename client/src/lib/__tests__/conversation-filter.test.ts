/**
 * @file conversation-filter.test.ts
 * @description Verifies transcript filtering by kind of content, by tool name
 * and by model: what each selection keeps, that a tool result follows its
 * call, and the counts the filter controls display.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_CONVERSATION_FILTER,
  conversationFacets,
  filterConversation,
  isConversationFilterActive,
  visibleMessageCount,
} from "../conversation-filter";
import type { ConversationFilter } from "../conversation-filter";
import type { TranscriptMessage } from "../types";

const ts = "2026-08-01T12:00:00.000Z";
const OPUS = "claude-opus-5-5";
const QWEN = "qwen3.8:27b";

const messages: TranscriptMessage[] = [
  { type: "session_event", event_kind: "rename", title: "Renamed", timestamp: ts, content: [] },
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
    model: QWEN,
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
];

const f = (part: Partial<ConversationFilter>): ConversationFilter => ({
  ...EMPTY_CONVERSATION_FILTER,
  ...part,
});
const kindsOf = (out: TranscriptMessage[]) => out.flatMap((m) => m.content.map((b) => b.type));
const idsOf = (out: TranscriptMessage[]) => out.flatMap((m) => m.content.map((b) => b.id));
const texts = (out: TranscriptMessage[]) =>
  out.flatMap((m) => m.content.filter((b) => b.type === "text").map((b) => b.text));

describe("conversation filter", () => {
  it("is inactive when empty and then returns the input untouched", () => {
    expect(isConversationFilterActive(EMPTY_CONVERSATION_FILTER)).toBe(false);
    expect(filterConversation(messages, EMPTY_CONVERSATION_FILTER)).toBe(messages);
    expect(isConversationFilterActive(f({ models: [QWEN] }))).toBe(true);
  });

  it("counts each kind, tool and model over the loaded messages", () => {
    const facets = conversationFacets(messages);
    expect(facets.kinds).toEqual({
      prompt: 1,
      reply: 2,
      thinking: 1,
      tool: 3,
      error: 1,
      system: 1,
    });
    expect(facets.tools).toEqual([
      { name: "read_file", count: 1 },
      { name: "search", count: 1 },
      { name: "write_file", count: 1 },
    ]);
    expect(facets.models).toEqual([
      { name: OPUS, count: 1 },
      { name: QWEN, count: 1 },
    ]);
  });

  it("keeps only the selected kinds of prose", () => {
    expect(texts(filterConversation(messages, f({ kinds: ["prompt"] })))).toEqual(["Fix the bug"]);
    expect(texts(filterConversation(messages, f({ kinds: ["reply"] })))).toEqual([
      "Reading the file.",
      "Fixed.",
    ]);
    expect(texts(filterConversation(messages, f({ kinds: ["system"] })))).toEqual(["stdout: done"]);
    expect(kindsOf(filterConversation(messages, f({ kinds: ["thinking"] })))).toEqual(["thinking"]);
  });

  it("keeps a tool call together with its result", () => {
    const out = filterConversation(messages, f({ kinds: ["tool"] }));
    expect(idsOf(out)).toEqual(["t1", "t2", "t1", "t2", "t3", "t3"]);
  });

  it("shows only failed calls for the error kind", () => {
    expect(idsOf(filterConversation(messages, f({ kinds: ["error"] })))).toEqual(["t2", "t2"]);
  });

  it("treats a tool selection as a request for those tool calls", () => {
    expect(idsOf(filterConversation(messages, f({ tools: ["read_file"] })))).toEqual(["t1", "t1"]);
    const withThinking = filterConversation(
      messages,
      f({ kinds: ["thinking"], tools: ["search"] })
    );
    expect(kindsOf(withThinking)).toEqual(["thinking", "tool_use", "tool_result"]);
  });

  it("shows everything one model wrote when only a model is selected", () => {
    const qwen = filterConversation(messages, f({ models: [QWEN] }));
    expect(texts(qwen)).toEqual(["Fixed."]);
    expect(idsOf(qwen).filter(Boolean)).toEqual(["t3", "t3"]);

    const opus = filterConversation(messages, f({ models: [OPUS] }));
    expect(kindsOf(opus)).toEqual([
      "thinking",
      "text",
      "tool_use",
      "tool_use",
      "tool_result",
      "tool_result",
    ]);
    // Prompts and system output have no model, so a model-only filter hides them.
    expect(texts(opus)).toEqual(["Reading the file."]);
  });

  it("combines a model with kinds and tools", () => {
    expect(texts(filterConversation(messages, f({ models: [QWEN], kinds: ["reply"] })))).toEqual([
      "Fixed.",
    ]);
    expect(idsOf(filterConversation(messages, f({ models: [OPUS], kinds: ["tool"] })))).toEqual([
      "t1",
      "t2",
      "t1",
      "t2",
    ]);
    // A tool that the selected model never called leaves nothing.
    expect(filterConversation(messages, f({ models: [QWEN], tools: ["search"] }))).toEqual([]);
    // Prompts stay available alongside a model when their kind is ticked.
    expect(
      texts(filterConversation(messages, f({ models: [QWEN], kinds: ["prompt", "reply"] })))
    ).toEqual(["Fix the bug", "Fixed."]);
  });

  it("drops session markers and emptied messages while a filter is active", () => {
    const out = filterConversation(messages, f({ kinds: ["prompt"] }));
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("user");
  });

  it("counts rows the way the list draws them", () => {
    // 8 messages, of which the three pure tool-result messages draw no row of their own.
    expect(visibleMessageCount(messages)).toBe(5);
    expect(visibleMessageCount(filterConversation(messages, f({ kinds: ["tool"] })))).toBe(2);
  });
});

/**
 * @file conversation-merge.test.ts
 * @description Verifies the pure merging of several transcript windows into one
 * time-ordered conversation: interleaving, tie-breaking, timestamp fallback,
 * the watermark that holds back messages older than a partially-loaded window,
 * and the append/prepend page helpers.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import { appendMessages, mergeTranscripts, prependMessages, sourceOf } from "../conversation-merge";
import type { SourcedMessage, TranscriptWindow } from "../conversation-merge";
import type { TranscriptInfo, TranscriptMessage } from "../types";

const at = (hour: number, minute = 0) =>
  new Date(Date.UTC(2026, 7, 1, hour, minute, 0)).toISOString();

const msg = (timestamp: string | null, text: string, id?: string): TranscriptMessage => ({
  type: "user",
  sender: "user",
  timestamp,
  content: [{ type: "text", text }],
  ...(id !== undefined ? { id } : {}),
});

const mainInfo: TranscriptInfo = {
  id: "main",
  name: "Main agent",
  type: "main",
  has_transcript: true,
};
const subInfo: TranscriptInfo = {
  id: "agent-1",
  name: "Qwen sub-agent",
  type: "subagent",
  subagent_type: "qwen",
  has_transcript: true,
};

const window = (
  info: TranscriptInfo,
  messages: TranscriptMessage[],
  hasMore: boolean,
  firstLine = 1,
  lastLine = 10
): TranscriptWindow => ({
  source: sourceOf(info),
  messages,
  firstLine,
  lastLine,
  hasMore,
});

const texts = (out: TranscriptMessage[]) =>
  out.flatMap((m) => m.content.filter((b) => b.type === "text").map((b) => b.text));
const sources = (out: SourcedMessage[]) => out.map((m) => m.source.id);

describe("sourceOf", () => {
  it("copies id, name, type and subagent_type", () => {
    expect(sourceOf(mainInfo)).toEqual({
      id: "main",
      name: "Main agent",
      type: "main",
      subagent_type: undefined,
    });
    expect(sourceOf(subInfo)).toEqual({
      id: "agent-1",
      name: "Qwen sub-agent",
      type: "subagent",
      subagent_type: "qwen",
    });
  });
});

describe("mergeTranscripts", () => {
  it("returns an empty conversation for no windows", () => {
    expect(mergeTranscripts([])).toEqual({
      messages: [],
      watermark: null,
      nextSourceId: null,
      heldBack: 0,
    });
  });

  it("interleaves two windows by time and tags each message with its source", () => {
    const main = window(
      mainInfo,
      [msg(at(12, 0), "main noon"), msg(at(12, 45), "main late")],
      false
    );
    const sub = window(subInfo, [msg(at(11, 30), "sub early"), msg(at(12, 15), "sub mid")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(texts(merged.messages)).toEqual(["sub early", "main noon", "sub mid", "main late"]);
    expect(sources(merged.messages)).toEqual(["agent-1", "main", "agent-1", "main"]);
    expect(merged.watermark).toBeNull();
    expect(merged.nextSourceId).toBeNull();
    expect(merged.heldBack).toBe(0);
  });

  it("breaks ties by window position and keeps the order inside a window", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main a"), msg(at(12, 0), "main b")], false);
    const sub = window(subInfo, [msg(at(12, 0), "sub a")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(texts(merged.messages)).toEqual(["main a", "main b", "sub a"]);
    expect(sources(merged.messages)).toEqual(["main", "main", "agent-1"]);
  });

  it("lets a null timestamp inherit the previous message's time", () => {
    const win = window(
      mainInfo,
      [msg(at(12, 0), "first"), msg(null, "no time"), msg(at(13, 0), "last")],
      false
    );
    const sub = window(subInfo, [msg(at(12, 30), "sub")], false);
    const merged = mergeTranscripts([win, sub]);
    // "no time" takes 12:00, so it sorts with "first" (same window first) and
    // before the 12:30 sub-agent message.
    expect(texts(merged.messages)).toEqual(["first", "no time", "sub", "last"]);
  });

  it("lets a leading null timestamp inherit the next message's time", () => {
    const win = window(mainInfo, [msg(null, "no time"), msg(at(12, 0), "second")], false);
    const sub = window(subInfo, [msg(at(11, 0), "sub")], false);
    const merged = mergeTranscripts([win, sub]);
    expect(texts(merged.messages)).toEqual(["sub", "no time", "second"]);
  });

  it("uses time 0 when a window has no usable timestamp at all", () => {
    const win = window(mainInfo, [msg(null, "a"), msg(null, "b")], false);
    const sub = window(subInfo, [msg(at(11, 0), "sub")], false);
    const merged = mergeTranscripts([win, sub]);
    expect(texts(merged.messages)).toEqual(["a", "b", "sub"]);
  });

  it("holds back messages older than a partially-loaded window's oldest message", () => {
    const main = window(
      mainInfo,
      [msg(at(12, 0), "main noon"), msg(at(12, 45), "main late")],
      true
    );
    const sub = window(subInfo, [msg(at(11, 0), "sub early"), msg(at(12, 30), "sub mid")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.watermark).toBe(Date.parse(at(12, 0)));
    expect(merged.nextSourceId).toBe("main");
    expect(merged.heldBack).toBe(1);
    expect(texts(merged.messages)).toEqual(["main noon", "sub mid", "main late"]);
  });

  it("keeps messages equal to the watermark", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main noon")], true);
    const sub = window(subInfo, [msg(at(12, 0), "sub noon")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.heldBack).toBe(0);
    expect(texts(merged.messages)).toEqual(["main noon", "sub noon"]);
  });

  it("takes the later of two partially-loaded windows' oldest times as the watermark", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main noon")], true);
    const sub = window(subInfo, [msg(at(11, 30), "sub mid"), msg(at(13, 0), "sub late")], true);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.watermark).toBe(Date.parse(at(12, 0)));
    expect(merged.nextSourceId).toBe("main");
    expect(merged.heldBack).toBe(1);
    expect(texts(merged.messages)).toEqual(["main noon", "sub late"]);
  });

  it("prefers the earlier window when two watermarks tie", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main noon")], true);
    const sub = window(subInfo, [msg(at(12, 0), "sub noon")], true);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.watermark).toBe(Date.parse(at(12, 0)));
    expect(merged.nextSourceId).toBe("main");
    expect(merged.heldBack).toBe(0);
  });

  it("ignores a partially-loaded window with no messages for the watermark", () => {
    const main = window(mainInfo, [], true);
    const sub = window(subInfo, [msg(at(11, 0), "sub")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.watermark).toBeNull();
    expect(merged.nextSourceId).toBeNull();
    expect(merged.heldBack).toBe(0);
    expect(texts(merged.messages)).toEqual(["sub"]);
  });

  it("holds nothing back when no window has more", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main")], false);
    const sub = window(subInfo, [msg(at(11, 0), "sub")], false);
    const merged = mergeTranscripts([main, sub]);
    expect(merged.watermark).toBeNull();
    expect(merged.nextSourceId).toBeNull();
    expect(merged.heldBack).toBe(0);
    expect(texts(merged.messages)).toEqual(["sub", "main"]);
  });

  it("does not mutate its inputs", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main noon"), msg(null, "no time")], true);
    const sub = window(subInfo, [msg(at(11, 0), "sub early")], false);
    const before = JSON.parse(JSON.stringify({ main, sub })) as {
      main: TranscriptWindow;
      sub: TranscriptWindow;
    };
    mergeTranscripts([main, sub]);
    expect(main).toEqual(before.main);
    expect(sub).toEqual(before.sub);
  });

  it("returns shallow copies of the messages, not the originals", () => {
    const main = window(mainInfo, [msg(at(12, 0), "main")], false);
    const merged = mergeTranscripts([main]);
    expect(merged.messages).toHaveLength(1);
    expect(merged.messages[0]).not.toBe(main.messages[0]);
    expect(merged.messages[0]?.source).toEqual({
      id: "main",
      name: "Main agent",
      type: "main",
      subagent_type: undefined,
    });
  });
});

describe("appendMessages", () => {
  const base: TranscriptWindow = window(
    mainInfo,
    [msg(at(12, 0), "old", "m1"), msg(at(12, 5), "old2", "m2")],
    false,
    1,
    5
  );

  it("adds a page of newer messages at the end and updates lastLine", () => {
    const next = appendMessages(base, {
      messages: [msg(at(12, 10), "new", "m3")],
      last_line: 9,
    });
    expect(next).not.toBe(base);
    expect(texts(next.messages)).toEqual(["old", "old2", "new"]);
    expect(next.lastLine).toBe(9);
    expect(next.firstLine).toBe(1);
    expect(next.hasMore).toBe(false);
    expect(base.messages).toHaveLength(2);
    expect(base.lastLine).toBe(5);
  });

  it("with refresh, drops existing messages whose id appears in the page", () => {
    const next = appendMessages(base, {
      messages: [msg(at(12, 5), "old2 updated", "m2"), msg(at(12, 10), "new", "m3")],
      last_line: 9,
      refresh: true,
    });
    expect(texts(next.messages)).toEqual(["old", "old2 updated", "new"]);
    expect(next.lastLine).toBe(9);
  });

  it("with refresh, keeps messages without an id and those not in the page", () => {
    const win = window(mainInfo, [msg(at(12, 0), "no id"), msg(at(12, 5), "kept", "m2")], false);
    const next = appendMessages(win, {
      messages: [msg(at(12, 10), "new", "m3")],
      last_line: 9,
      refresh: true,
    });
    expect(texts(next.messages)).toEqual(["no id", "kept", "new"]);
  });

  it("returns the window unchanged for an empty page", () => {
    const next = appendMessages(base, { messages: [], last_line: 9 });
    expect(next).toBe(base);
  });
});

describe("prependMessages", () => {
  const base: TranscriptWindow = window(mainInfo, [msg(at(12, 0), "newer")], true, 5, 9);

  it("puts an older page in front and updates firstLine and hasMore", () => {
    const next = prependMessages(base, {
      messages: [msg(at(11, 0), "older")],
      first_line: 1,
      has_more: true,
    });
    expect(next).not.toBe(base);
    expect(texts(next.messages)).toEqual(["older", "newer"]);
    expect(next.firstLine).toBe(1);
    expect(next.hasMore).toBe(true);
    expect(next.lastLine).toBe(9);
    expect(base.messages).toHaveLength(1);
    expect(base.firstLine).toBe(5);
  });

  it("clears hasMore for an empty page and keeps everything else", () => {
    const next = prependMessages(base, { messages: [], first_line: 0, has_more: true });
    expect(next).not.toBe(base);
    expect(next.hasMore).toBe(false);
    expect(next.messages).toBe(base.messages);
    expect(next.firstLine).toBe(5);
    expect(next.lastLine).toBe(9);
    expect(base.hasMore).toBe(true);
  });
});

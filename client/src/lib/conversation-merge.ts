/**
 * @file conversation-merge.ts
 * @description Pure logic for combining the loaded windows of a session's
 * transcripts (main agent plus sub-agents) into one time-ordered conversation,
 * holding back messages older than a partially-loaded window's oldest message.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import type { TranscriptInfo, TranscriptMessage } from "./types";

/** Which transcript a message came from. */
export interface TranscriptSource {
  id: string;
  name: string;
  type: TranscriptInfo["type"];
  subagent_type?: string | null;
}

/** A message tagged with the transcript it came from. */
export type SourcedMessage = TranscriptMessage & { source: TranscriptSource };

/** The part of one transcript that has been loaded so far. Messages are oldest first. */
export interface TranscriptWindow {
  source: TranscriptSource;
  messages: TranscriptMessage[];
  /** JSONL line of the oldest loaded message (cursor for loading older ones). */
  firstLine: number;
  /** JSONL line of the newest loaded message (cursor for loading newer ones). */
  lastLine: number;
  /** True when older messages exist that are not loaded yet. */
  hasMore: boolean;
}

export interface MergedConversation {
  /** All visible messages, oldest first. */
  messages: SourcedMessage[];
  /** Time (ms since epoch) before which messages are held back, or null when nothing is held back. */
  watermark: number | null;
  /** id of the window to load older messages from next, or null when no window has more. */
  nextSourceId: string | null;
  /** How many loaded messages are held back because they are older than the watermark. */
  heldBack: number;
}

/** Copy the identifying fields of a transcript entry into a message source tag. */
export function sourceOf(info: TranscriptInfo): TranscriptSource {
  return {
    id: info.id,
    name: info.name,
    type: info.type,
    subagent_type: info.subagent_type,
  };
}

/**
 * Effective time (ms since epoch) of each message in a window. A message with a
 * null or unparseable timestamp takes the effective time of the previous message
 * in the window, or of the next message that has one; 0 when the window has no
 * usable timestamp at all.
 */
function effectiveTimes(messages: TranscriptMessage[]): number[] {
  const times: (number | undefined)[] = [];
  for (const message of messages) {
    const parsed = message.timestamp === null ? NaN : Date.parse(message.timestamp);
    times.push(Number.isNaN(parsed) ? undefined : parsed);
  }
  for (let i = 1; i < times.length; i += 1) {
    if (times[i] === undefined) times[i] = times[i - 1];
  }
  for (let i = 0; i < times.length; i += 1) {
    if (times[i] !== undefined) continue;
    let j = i + 1;
    while (j < times.length && times[j] === undefined) j += 1;
    times[i] = times[j];
  }
  // Make effective times non-decreasing inside a window so that a later
  // message carrying an earlier timestamp never reorders ahead of an earlier
  // message in the same window.
  for (let i = 1; i < times.length; i += 1) {
    const prev = times[i - 1];
    const current = times[i];
    if (prev !== undefined && (current === undefined || current < prev)) {
      times[i] = prev;
    }
  }
  return times.map((t) => t ?? 0);
}

/**
 * Merge the loaded windows of a session's transcripts into one conversation.
 * Messages are ordered by effective time (ties: earlier window first, then
 * position inside the window). Messages older than the watermark - the oldest
 * loaded message of the partially-loaded window with the latest such time - are
 * held back until that window is paged further back. Inputs are never mutated.
 */
export function mergeTranscripts(windows: TranscriptWindow[]): MergedConversation {
  if (windows.length === 0) {
    return { messages: [], watermark: null, nextSourceId: null, heldBack: 0 };
  }

  const entries: {
    time: number;
    windowIndex: number;
    messageIndex: number;
    message: TranscriptMessage;
    source: TranscriptSource;
  }[] = [];
  windows.forEach((window, windowIndex) => {
    const times = effectiveTimes(window.messages);
    window.messages.forEach((message, messageIndex) => {
      entries.push({
        time: times[messageIndex] ?? 0,
        windowIndex,
        messageIndex,
        message,
        source: window.source,
      });
    });
  });

  entries.sort(
    (a, b) => a.time - b.time || a.windowIndex - b.windowIndex || a.messageIndex - b.messageIndex
  );

  let watermark: number | null = null;
  let nextSourceId: string | null = null;
  for (const window of windows) {
    if (!window.hasMore || window.messages.length === 0) continue;
    const oldest = effectiveTimes(window.messages)[0] ?? 0;
    if (watermark === null || oldest > watermark) {
      watermark = oldest;
      nextSourceId = window.source.id;
    }
  }

  const messages: SourcedMessage[] = [];
  let heldBack = 0;
  for (const entry of entries) {
    if (watermark !== null && entry.time < watermark) {
      heldBack += 1;
      continue;
    }
    messages.push({ ...entry.message, source: entry.source });
  }

  return { messages, watermark, nextSourceId, heldBack };
}

/**
 * Fold a page of newer messages into a window, returning a new window. With
 * `refresh` the page is a latest window keyed by message id: existing messages
 * with a non-empty id that appears in the page are dropped first. An empty page
 * leaves the window unchanged.
 */
export function appendMessages(
  window: TranscriptWindow,
  page: { messages: TranscriptMessage[]; last_line: number; refresh?: boolean }
): TranscriptWindow {
  if (page.messages.length === 0) return window;
  let kept = window.messages;
  if (page.refresh) {
    const ids = new Set(
      page.messages
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id !== "")
    );
    kept = window.messages.filter((m) => !(m.id && ids.has(m.id)));
  }
  return {
    ...window,
    messages: [...kept, ...page.messages],
    lastLine: page.last_line,
  };
}

/**
 * Fold a page of older messages in front of a window, returning a new window.
 * An empty page means there is nothing older: `hasMore` becomes false and the
 * rest of the window is unchanged.
 */
export function prependMessages(
  window: TranscriptWindow,
  page: { messages: TranscriptMessage[]; first_line: number; has_more: boolean }
): TranscriptWindow {
  if (page.messages.length === 0) {
    return { ...window, hasMore: false };
  }
  return {
    ...window,
    messages: [...page.messages, ...window.messages],
    firstLine: page.first_line,
    hasMore: page.has_more,
  };
}

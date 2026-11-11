/**
 * @file conversation-filter.ts
 * @description Client-side filtering of a loaded transcript by the kind of
 * content (prompts, replies, thinking, tool calls, errors, system output), by
 * tool name and by model, plus the counts the filter controls show.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import type { TranscriptContent, TranscriptMessage } from "./types";

/** The kinds of content a conversation can be filtered by, in display order. */
export const CONVERSATION_KINDS = [
  "prompt",
  "reply",
  "thinking",
  "tool",
  "error",
  "system",
] as const;

export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export interface ConversationFilter {
  /** Kinds to keep. Empty means no kind filter. */
  kinds: ConversationKind[];
  /** Tool names to keep. Empty means no tool filter; a selection implies tool calls are shown. */
  tools: string[];
  /**
   * Models to keep. Empty means no model filter. A selection narrows what the
   * assistant wrote (replies, thinking, tool calls) to those models; prompts and
   * system output have no model and stay governed by `kinds`.
   */
  models: string[];
}

export interface ConversationFacets {
  kinds: Record<ConversationKind, number>;
  /** Tool names with their call counts, most used first. */
  tools: { name: string; count: number }[];
  /** Models with the number of assistant messages each wrote, most active first. */
  models: { name: string; count: number }[];
}

export const EMPTY_CONVERSATION_FILTER: ConversationFilter = { kinds: [], tools: [], models: [] };

export function isConversationFilterActive(filter: ConversationFilter): boolean {
  return filter.kinds.length > 0 || filter.tools.length > 0 || filter.models.length > 0;
}

/** Most frequent first, then by name, so the order is stable between renders. */
function byCount(counts: Map<string, number>): { name: string; count: number }[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** Ids of the tool calls whose result came back as an error. */
function erroredToolIds(messages: TranscriptMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_result" && block.is_error && block.id) ids.add(block.id);
    }
  }
  return ids;
}

/**
 * Kind of a text or image block, from who wrote the message. Thinking and tool
 * blocks are classified by their own type instead.
 */
function proseKind(msg: TranscriptMessage): ConversationKind {
  const sender = msg.sender ?? (msg.type === "assistant" ? "assistant" : "user");
  if (sender === "assistant") return "reply";
  if (sender === "system" || sender === "tool") return "system";
  return "prompt";
}

function hasProse(block: TranscriptContent): boolean {
  return block.type === "image" || (block.type === "text" && !!block.text?.trim());
}

/** Counts shown next to each filter option, over the messages loaded so far. */
export function conversationFacets(messages: TranscriptMessage[]): ConversationFacets {
  const kinds = { prompt: 0, reply: 0, thinking: 0, tool: 0, error: 0, system: 0 };
  const tools = new Map<string, number>();
  const models = new Map<string, number>();
  const errored = erroredToolIds(messages);
  for (const msg of messages) {
    if (msg.type === "session_event") continue;
    if (msg.type === "assistant" && msg.model) {
      models.set(msg.model, (models.get(msg.model) ?? 0) + 1);
    }
    for (const block of msg.content) {
      if (block.type === "thinking") {
        kinds.thinking += 1;
      } else if (block.type === "tool_use") {
        kinds.tool += 1;
        if (block.id && errored.has(block.id)) kinds.error += 1;
        const name = block.name || "tool";
        tools.set(name, (tools.get(name) ?? 0) + 1);
      } else if (hasProse(block)) {
        kinds[proseKind(msg)] += 1;
      }
    }
  }
  return { kinds, tools: byCount(tools), models: byCount(models) };
}

/**
 * Keep only the content the filter selects. Messages left with nothing are
 * dropped. A tool result is kept exactly when its tool call is, so a kept call
 * still shows its output; with an inactive filter the input is returned as is.
 */
export function filterConversation(
  messages: TranscriptMessage[],
  filter: ConversationFilter
): TranscriptMessage[] {
  if (!isConversationFilterActive(filter)) return messages;
  const kinds = new Set<ConversationKind>(filter.kinds);
  const tools = new Set(filter.tools);
  const models = new Set(filter.models);
  const kindsActive = kinds.size > 0;
  const toolsActive = tools.size > 0;
  const modelsActive = models.size > 0;
  // Only a model is selected: show everything those models wrote.
  const modelOnly = modelsActive && !kindsActive && !toolsActive;
  const errored = erroredToolIds(messages);

  const modelOk = (msg: TranscriptMessage): boolean =>
    !modelsActive || (!!msg.model && models.has(msg.model));

  const keepToolCall = (block: TranscriptContent, msg: TranscriptMessage): boolean => {
    if (!modelOk(msg)) return false;
    if (toolsActive && !tools.has(block.name || "tool")) return false;
    if (toolsActive || modelOnly || kinds.has("tool")) return true;
    return kinds.has("error") && !!block.id && errored.has(block.id);
  };

  // First pass: which tool calls survive, so their results can follow them.
  const keptCalls = new Set<string>();
  for (const msg of messages) {
    for (const block of msg.content) {
      if (block.type === "tool_use" && block.id && keepToolCall(block, msg)) {
        keptCalls.add(block.id);
      }
    }
  }

  const out: TranscriptMessage[] = [];
  for (const msg of messages) {
    if (msg.type === "session_event") continue;
    const content = msg.content.filter((block) => {
      if (block.type === "tool_use") return keepToolCall(block, msg);
      if (block.type === "tool_result") return !!block.id && keptCalls.has(block.id);
      if (block.type === "thinking") return modelOk(msg) && (modelOnly || kinds.has("thinking"));
      if (!hasProse(block)) return false;
      const kind = proseKind(msg);
      if (kind === "reply") return modelOk(msg) && (modelOnly || kinds.has("reply"));
      // Prompts and system output: shown only when their kind is selected, so a
      // tool-only or model-only filter hides them.
      return kinds.has(kind);
    });
    if (content.length > 0) out.push({ ...msg, content });
  }
  return out;
}

/** Number of messages that render a row of their own (pure tool-result messages do not). */
export function visibleMessageCount(messages: TranscriptMessage[]): number {
  return messages.filter(
    (msg) => msg.type === "session_event" || msg.content.some((b) => b.type !== "tool_result")
  ).length;
}

/**
 * @file conversation-turns.ts
 * @description Pure helpers that group a flat transcript message stream into
 * conversation "turns" (one user prompt plus everything the agents did in
 * response) and derive compact per-turn summaries for the digest view.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import type { TranscriptMessage } from "./types";

/** A single conversation turn: one prompt plus the agent activity that answered it. */
export interface ConversationTurn {
  /** Stable index of the turn within the current message stream (0-based). */
  index: number;
  /** The user prompt that opened the turn, or null when the stream starts with agent activity. */
  prompt: TranscriptMessage | null;
  /** One-line preview of the prompt text, or null when the turn has no prompt. */
  promptPreview: string | null;
  /** Sender of the prompt (usually "user"), or null. */
  promptSender: string | null;
  /** The messages that make up the turn, in stream order (prompt included when present). */
  messages: TranscriptMessage[];
  /** First assistant text content found in the turn, or null. */
  replyPreview: string | null;
  /** Number of tool_use blocks in the turn. */
  toolCount: number;
  /** Number of thinking blocks in the turn. */
  thinkingCount: number;
  /** Number of error blocks in the turn. */
  errorCount: number;
  /** Number of distinct agents (by sender) that produced messages in the turn. */
  agentCount: number;
  /** Senders that produced messages in the turn. */
  senders: Set<string>;
  /** ISO timestamp of the first message in the turn, or null. */
  startedAt: string | null;
}

/**
 * Group a flat message stream into turns.
 *
 * A new turn starts at every user message that carries visible text content.
 * User messages that are pure tool_result (no text) do not start a turn; they
 * belong to the turn they answer. Agent messages before the first text prompt
 * are collected into a leading turn with `prompt: null`.
 */
export function groupIntoTurns(messages: TranscriptMessage[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  let current: ConversationTurn | null = null;

  const ensure = (): ConversationTurn => {
    if (!current) {
      current = {
        index: turns.length,
        prompt: null,
        promptPreview: null,
        promptSender: null,
        messages: [],
        replyPreview: null,
        toolCount: 0,
        thinkingCount: 0,
        errorCount: 0,
        agentCount: 0,
        senders: new Set<string>(),
        startedAt: null,
      };
      turns.push(current);
    }
    return current;
  };

  for (const message of messages) {
    const isTextPrompt =
      message.type === "user" &&
      message.sender === "user" &&
      message.content.some(
        (block) => block.type === "text" && (block.text ?? "").trim().length > 0
      );

    if (isTextPrompt) {
      // A text prompt always opens a fresh turn.
      current = null;
    }

    const turn = ensure();
    if (isTextPrompt && turn.prompt === null) {
      turn.prompt = message;
      turn.promptPreview = makePreview(
        message.content
          .filter((block) => block.type === "text")
          .map((block) => block.text ?? "")
          .join(" ")
      );
      turn.promptSender = message.sender ?? null;
    }
    turn.messages.push(message);
    if (turn.startedAt === null) turn.startedAt = message.timestamp;
    if (message.sender) turn.senders.add(message.sender);

    for (const block of message.content) {
      if (block.type === "tool_use") turn.toolCount += 1;
      else if (block.type === "thinking") turn.thinkingCount += 1;
      else if (block.type === "tool_result" && block.is_error) turn.errorCount += 1;
      else if (
        block.type === "text" &&
        turn.replyPreview === null &&
        message.type === "assistant"
      ) {
        turn.replyPreview = block.text ?? "";
      }
    }
  }

  for (const turn of turns) turn.agentCount = turn.senders.size;
  return turns;
}

/** Collapse whitespace and truncate a preview to a single readable line. */
export function makePreview(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  return flat.slice(0, maxLength - 1).trimEnd() + "…";
}

/**
 * Case-insensitive search over turns: keeps turns whose prompt, reply preview,
 * or any message text contains the query.
 */
export function filterTurns(turns: ConversationTurn[], query: string): ConversationTurn[] {
  const q = query.trim().toLowerCase();
  if (!q) return turns;
  return turns.filter((turn) => {
    if ((turn.promptPreview ?? "").toLowerCase().includes(q)) return true;
    if ((turn.replyPreview ?? "").toLowerCase().includes(q)) return true;
    return turn.messages.some((message) =>
      message.content.some((block) => {
        if (block.type === "text") return (block.text ?? "").toLowerCase().includes(q);
        if (block.type === "thinking") return (block.text ?? "").toLowerCase().includes(q);
        if (block.type === "tool_use") return (block.name ?? "").toLowerCase().includes(q);
        return false;
      })
    );
  });
}

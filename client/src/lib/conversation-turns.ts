/**
 * @file conversation-turns.ts
 * @description Pure helpers that group a flat transcript message stream into
 * conversation "turns" (one user prompt plus everything that happened until
 * the next prompt) and derive the per-turn steps shown in the digest view.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import type { TranscriptMessage } from "./types";
import type { SourcedMessage } from "./conversation-merge";

export type TurnStepKind = "said" | "tools" | "agent";

export interface TurnStep {
  kind: TurnStepKind;
  /** Unique within its turn and stable across re-renders. */
  key: string;
  /** The messages of this step, in stream order. */
  messages: TranscriptMessage[];
  /** One line: said -> the text; tools -> "Bash ×3, Edit ×2"; agent -> the sub-agent's name. */
  label: string;
  toolCount: number;
  errorCount: number;
}

export interface ConversationTurn {
  /** Stable identity. Must not change when older messages are prepended or newer ones appended. */
  key: string;
  /** True for a leading group of messages that has no prompt (its prompt is not loaded). */
  partial: boolean;
  prompt: TranscriptMessage | null;
  /** One-line preview of the prompt text, "" when partial. */
  promptPreview: string;
  answer: TranscriptMessage | null;
  /** One-line preview of the answer text, "" when there is none. */
  answerPreview: string;
  /** Everything except the prompt and the answer, grouped. */
  steps: TurnStep[];
  /** Every message of the turn, in stream order (prompt and answer included). */
  messages: TranscriptMessage[];
  toolCount: number;
  errorCount: number;
  /** Number of distinct sub-agents (by `source.id`) that took part. */
  agentCount: number;
  startedAt: string | null;
  endedAt: string | null;
}

/** The transcript a message came from, or undefined for single-transcript views. */
function sourceOf(message: TranscriptMessage): SourcedMessage["source"] | undefined {
  return "source" in message ? (message as SourcedMessage).source : undefined;
}

/** True when the message carries at least one non-empty text block. */
function hasText(message: TranscriptMessage): boolean {
  return message.content.some(
    (block) => block.type === "text" && (block.text ?? "").trim().length > 0
  );
}

/** All text blocks of a message joined into one line. */
function textOf(message: TranscriptMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join(" ");
}

/** A user prompt: a user-type message from the human (or an untagged one) with visible text. */
function isPrompt(message: TranscriptMessage): boolean {
  return (
    message.type === "user" &&
    (message.sender === "user" || message.sender === undefined) &&
    hasText(message)
  );
}

/** True for a message produced by a sub-agent (a main-agent message has no source or `type === "main"`). */
function isSubAgent(message: TranscriptMessage): boolean {
  const source = sourceOf(message);
  return source !== undefined && source.type !== "main";
}

/** Short display name of a tool: the last segment of an MCP name (`mcp__server__tool` -> `tool`). */
export function shortToolName(name: string): string {
  if (name.startsWith("mcp__")) {
    const last = name.lastIndexOf("__");
    if (last > "mcp__".length) return name.slice(last + 2);
  }
  return name;
}

/** "Bash ×3, Edit ×2" in first-seen order; a single call has no count; "" when there is no tool call. */
function toolLabel(messages: TranscriptMessage[]): string {
  const counts = new Map<string, number>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use" && block.name) {
        const short = shortToolName(block.name);
        counts.set(short, (counts.get(short) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
    .join(", ");
}

function countTools(messages: TranscriptMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_use") count += 1;
    }
  }
  return count;
}

function countErrors(messages: TranscriptMessage[]): number {
  let count = 0;
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool_result" && block.is_error) count += 1;
    }
  }
  return count;
}

/**
 * Group a flat message stream into turns, oldest first.
 *
 * A new turn starts at every user prompt (a user-type message from the human
 * with visible text). Messages before the first prompt form one leading turn
 * with `partial: true` and `prompt: null`.
 */
export function groupIntoTurns(messages: TranscriptMessage[]): ConversationTurn[] {
  // Split the stream into raw groups: each group starts at a prompt, except
  // possibly the first one.
  const groups: TranscriptMessage[][] = [];
  let current: TranscriptMessage[] | null = null;
  for (const message of messages) {
    if (isPrompt(message) || current === null) {
      current = [message];
      groups.push(current);
    } else {
      current.push(message);
    }
  }

  const usedKeys = new Set<string>();
  const uniqueKey = (base: string): string => {
    let key = base;
    let suffix = 2;
    while (usedKeys.has(key)) key = `${base}-${suffix++}`;
    usedKeys.add(key);
    return key;
  };

  return groups.map((group, index) => {
    const partial = index === 0 && !isPrompt(group[0]!);
    const prompt = partial ? null : group[0]!;
    const key = partial
      ? uniqueKey("earlier")
      : uniqueKey(prompt!.id ?? prompt!.timestamp ?? `turn-${index}`);

    // The answer is the LAST main-agent assistant message with non-empty text.
    let answer: TranscriptMessage | null = null;
    for (const message of group) {
      if (message.type === "assistant" && !isSubAgent(message) && hasText(message))
        answer = message;
    }

    // Steps, walking the turn's messages in order, skipping prompt and answer.
    const steps: TurnStep[] = [];
    const agentSteps = new Map<string, TurnStep>();
    for (const message of group) {
      if (message === prompt || message === answer) continue;
      if (isSubAgent(message)) {
        const source = sourceOf(message)!;
        let step = agentSteps.get(source.id);
        if (!step) {
          step = {
            kind: "agent",
            key: `s${steps.length}`,
            messages: [],
            label: source.name,
            toolCount: 0,
            errorCount: 0,
          };
          agentSteps.set(source.id, step);
          steps.push(step);
        }
        step.messages.push(message);
      } else if (message.type === "assistant" && hasText(message)) {
        steps.push({
          kind: "said",
          key: `s${steps.length}`,
          messages: [message],
          label: makePreview(textOf(message)),
          toolCount: 0,
          errorCount: 0,
        });
      } else {
        const last = steps[steps.length - 1];
        if (last && last.kind === "tools") {
          last.messages.push(message);
        } else {
          steps.push({
            kind: "tools",
            key: `s${steps.length}`,
            messages: [message],
            label: "",
            toolCount: 0,
            errorCount: 0,
          });
        }
      }
    }
    for (const step of steps) {
      step.toolCount = countTools(step.messages);
      step.errorCount = countErrors(step.messages);
      if (step.kind === "tools") step.label = toolLabel(step.messages);
    }

    return {
      key,
      partial,
      prompt,
      promptPreview: prompt ? makePreview(textOf(prompt)) : "",
      answer,
      answerPreview: answer ? makePreview(textOf(answer)) : "",
      steps,
      messages: group,
      toolCount: countTools(group),
      errorCount: countErrors(group),
      agentCount: agentSteps.size,
      startedAt: group[0]?.timestamp ?? null,
      endedAt: group[group.length - 1]?.timestamp ?? null,
    };
  });
}

/** Collapse whitespace and truncate a preview to a single readable line. */
export function makePreview(text: string, maxLength = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= maxLength) return flat;
  return flat.slice(0, maxLength - 1).trimEnd() + "…";
}

/**
 * Case-insensitive search over turns: a turn matches when the query is in its
 * prompt text, its answer text, any message text, or any tool name. An empty
 * query returns the input unchanged.
 */
export function filterTurns(turns: ConversationTurn[], query: string): ConversationTurn[] {
  const q = query.trim().toLowerCase();
  if (!q) return turns;
  return turns.filter((turn) => {
    if (turn.prompt && textOf(turn.prompt).toLowerCase().includes(q)) return true;
    if (turn.answer && textOf(turn.answer).toLowerCase().includes(q)) return true;
    return turn.messages.some((message) =>
      message.content.some((block) => {
        if (block.type === "text" || block.type === "thinking") {
          return (block.text ?? "").toLowerCase().includes(q);
        }
        if (block.type === "tool_use") return (block.name ?? "").toLowerCase().includes(q);
        return false;
      })
    );
  });
}

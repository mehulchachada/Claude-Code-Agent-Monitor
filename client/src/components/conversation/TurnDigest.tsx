/**
 * @file TurnDigest.tsx
 * @description Digest view for the Conversation tab: groups a flat message
 * stream into turns (prompt + agent activity) and renders each turn as a
 * compact card. Collapsed cards show the prompt, a one-line reply preview, and
 * badges for tool calls / thinking / errors. Expanding a card reveals the full
 * message list for that turn, reusing the existing MessageList renderer.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Bot, User, Brain, Terminal, AlertTriangle } from "lucide-react";
import type { ConversationTurn } from "../../lib/conversation-turns";
import { makePreview } from "../../lib/conversation-turns";
import { MessageList } from "./MessageList";
import { useTranslation } from "react-i18next";

/** Props for {@link TurnDigest}. */
interface TurnDigestProps {
  /** Turns derived from the current (filtered) message stream. */
  turns: ConversationTurn[];
  /** Show a source chip per message (combined view). */
  showSource?: boolean;
  /** Index of a turn to expand and scroll into view (jump-to-turn). */
  focusIndex?: number | null;
}

/** A single turn card in the digest view. */
function TurnCard({
  turn,
  showSource,
  expanded,
  onToggle,
}: {
  turn: ConversationTurn;
  showSource: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation("sessions");
  const promptText = turn.prompt
    ? turn.prompt.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join(" ")
        .trim()
    : null;
  const preview = turn.replyPreview ? makePreview(turn.replyPreview) : null;

  return (
    <div
      data-testid="turn-card"
      data-turn-index={turn.index}
      className="rounded-lg border border-surface-3 bg-surface-2/50 overflow-hidden"
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-2 transition-colors"
      >
        <span className="mt-0.5 flex-shrink-0 text-gray-500">
          {expanded ? (
            <ChevronDown className="w-4 h-4" />
          ) : (
            <ChevronRight className="w-4 h-4" />
          )}
        </span>
        <span className="flex-1 min-w-0">
          <span className="flex items-center gap-2 mb-1">
            <User className="w-3.5 h-3.5 text-blue-300 flex-shrink-0" />
            <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              {t("detail.transcript.digest.prompt")}
            </span>
          </span>
          <span className="block text-sm text-gray-200 leading-snug break-words">
            {promptText ?? t("detail.transcript.digest.noPrompt")}
          </span>
          {preview && (
            <>
              <span className="flex items-center gap-2 mt-2 mb-1">
                <Bot className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />
                <span className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
                  {t("detail.transcript.digest.reply")}
                </span>
              </span>
              <span className="block text-xs text-gray-400 leading-snug break-words">{preview}</span>
            </>
          )}
          <span className="flex flex-wrap items-center gap-2 mt-2">
            {turn.toolCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-1.5 py-0.5">
                <Terminal className="w-3 h-3" />
                {turn.toolCount} {t("detail.transcript.digest.tools")}
              </span>
            )}
            {turn.thinkingCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-violet-300 bg-violet-500/10 border border-violet-500/20 rounded-md px-1.5 py-0.5">
                <Brain className="w-3 h-3" />
                {turn.thinkingCount} {t("detail.transcript.digest.thinking")}
              </span>
            )}
            {turn.errorCount > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-red-300 bg-red-500/10 border border-red-500/20 rounded-md px-1.5 py-0.5">
                <AlertTriangle className="w-3 h-3" />
                {turn.errorCount} {t("detail.transcript.digest.errors")}
              </span>
            )}
            {turn.agentCount > 1 && (
              <span className="inline-flex items-center gap-1 text-[11px] text-teal-300 bg-teal-500/10 border border-teal-500/20 rounded-md px-1.5 py-0.5">
                <Bot className="w-3 h-3" />
                {turn.agentCount} {t("detail.transcript.digest.agents")}
              </span>
            )}
            <span className="text-[11px] text-gray-500">
              {turn.messages.length} {t("detail.transcript.digest.messages")}
            </span>
          </span>
        </span>
      </button>
      {expanded && (
        <div className="border-t border-surface-3 px-4 py-3 bg-surface-1/50">
          <MessageList messages={turn.messages} loading={false} showSource={showSource} />
        </div>
      )}
    </div>
  );
}

/**
 * Render a list of conversation turns as compact, expandable cards.
 *
 * @param props - Turns and display options.
 * @returns A vertical stack of turn cards.
 */
export function TurnDigest({ turns, showSource = false, focusIndex = null }: TurnDigestProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback((index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  // Jump-to-turn: expand the requested turn and scroll it into view.
  useEffect(() => {
    if (focusIndex === null || focusIndex === undefined) return;
    setExpanded((prev) => {
      if (prev.has(focusIndex)) return prev;
      const next = new Set(prev);
      next.add(focusIndex);
      return next;
    });
    const el = listRef.current?.querySelector(`[data-turn-index="${focusIndex}"]`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusIndex]);

  if (turns.length === 0) return null;

  return (
    <div className="flex flex-col gap-2" data-testid="turn-digest" ref={listRef}>
      {turns.map((turn) => (
        <TurnCard
          key={turn.index}
          turn={turn}
          showSource={showSource}
          expanded={expanded.has(turn.index)}
          onToggle={() => toggle(turn.index)}
        />
      ))}
    </div>
  );
}

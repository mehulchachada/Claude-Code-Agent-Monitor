/**
 * @file TurnOutline.tsx
 * @description Left pane of the digest view: a fixed-height, searchable list of
 * conversation turns (newest first) with prompt/answer previews and tool,
 * sub-agent and error chips. Arrow keys move the selection.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useCallback, useRef } from "react";
import { AlertTriangle, Cpu, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationTurn } from "../../lib/conversation-turns";
import { formatDateTime, formatDuration } from "../../lib/format";

/** Props for {@link TurnOutline}. */
interface TurnOutlineProps {
  /** Turns to display, already filtered, newest first. */
  turns: ConversationTurn[];
  /** 1-based number of each turn, counting from the oldest loaded turn. */
  numbers: Map<string, number>;
  /** Total number of turns before filtering. */
  totalCount: number;
  /** Key of the currently selected turn. */
  selectedKey: string | null;
  /** Select a turn by key. */
  onSelect: (key: string) => void;
  /** Current search query. */
  query: string;
  /** Update the search query. */
  onQueryChange: (query: string) => void;
  /** True while older history is still being loaded. */
  loadingHistory: boolean;
}

/**
 * Render the turn outline list with search, count line and keyboard navigation.
 *
 * @param props - Turns and selection state.
 * @returns The left digest pane.
 */
export function TurnOutline({
  turns,
  numbers,
  totalCount,
  selectedKey,
  onSelect,
  query,
  onQueryChange,
  loadingHistory,
}: TurnOutlineProps) {
  const { t } = useTranslation("sessions");
  const listRef = useRef<HTMLUListElement>(null);

  const moveSelection = useCallback(
    (delta: number) => {
      if (turns.length === 0) return;
      const index = turns.findIndex((turn) => turn.key === selectedKey);
      const nextIndex = index === -1 ? 0 : Math.min(turns.length - 1, Math.max(0, index + delta));
      const next = turns[nextIndex];
      if (!next) return;
      onSelect(next.key);
      const button = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-turn-key="${next.key}"]`
      );
      button?.scrollIntoView?.({ block: "nearest" });
    },
    [turns, selectedKey, onSelect]
  );

  const searching = query.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="sticky top-0 z-10 bg-surface-0 pb-2">
        <input
          type="search"
          data-testid="turn-search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t("detail.transcript.digest.searchPlaceholder")}
          aria-label={t("detail.transcript.digest.searchPlaceholder")}
          className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm text-gray-200 placeholder:text-gray-500 focus:border-accent focus:outline-none"
        />
        <p className="mt-1.5 text-[11px] text-gray-500">
          {searching
            ? t("detail.transcript.digest.turnCountFiltered", {
                shown: turns.length,
                total: totalCount,
              })
            : t("detail.transcript.digest.turnCount", { count: turns.length })}
          {loadingHistory && ` · ${t("detail.transcript.digest.loadingHistory")}`}
        </p>
      </div>
      {turns.length === 0 ? (
        <p className="px-1 py-4 text-sm text-gray-500">
          {searching
            ? t("detail.transcript.digest.noMatch")
            : t("detail.transcript.digest.noTurns")}
        </p>
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={t("detail.transcript.digest.listLabel")}
          className="space-y-2"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveSelection(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(-1);
            }
          }}
        >
          {turns.map((turn) => {
            const selected = turn.key === selectedKey;
            return (
              <li key={turn.key} role="option" aria-selected={selected}>
                <button
                  type="button"
                  data-testid="turn-item"
                  data-turn-key={turn.key}
                  onClick={() => onSelect(turn.key)}
                  className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                    selected
                      ? "border-accent bg-accent/10"
                      : "border-surface-3 bg-surface-2/40 hover:bg-surface-2"
                  }`}
                >
                  <span className="space-y-1">
                    <span className="flex items-center justify-between text-[11px] text-gray-500">
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-gray-400">#{numbers.get(turn.key)}</span>
                        <span>{turn.startedAt ? formatDateTime(turn.startedAt) : ""}</span>
                      </span>
                      {turn.startedAt && turn.endedAt && (
                        <span>{formatDuration(turn.startedAt, turn.endedAt)}</span>
                      )}
                    </span>
                    <span className="text-sm font-medium text-gray-200 line-clamp-2 [overflow-wrap:anywhere]">
                      {turn.partial ? t("detail.transcript.digest.earlier") : turn.promptPreview}
                    </span>
                    {!turn.partial && turn.answerPreview && (
                      <span className="text-xs text-gray-500 line-clamp-1">
                        {turn.answerPreview}
                      </span>
                    )}
                    {(turn.toolCount > 0 || turn.agentCount > 0 || turn.errorCount > 0) && (
                      <span className="flex flex-wrap gap-1.5">
                        {turn.toolCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-surface-3 bg-surface-2 px-1.5 py-0.5 text-[11px] text-gray-400">
                            <Wrench className="w-3 h-3" />
                            {t("detail.transcript.digest.chipTools", { count: turn.toolCount })}
                          </span>
                        )}
                        {turn.agentCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[11px] text-amber-300">
                            <Cpu className="w-3 h-3" />
                            {t("detail.transcript.digest.chipAgents", { count: turn.agentCount })}
                          </span>
                        )}
                        {turn.errorCount > 0 && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-red-500/20 bg-red-500/10 px-1.5 py-0.5 text-[11px] text-red-300">
                            <AlertTriangle className="w-3 h-3" />
                            {t("detail.transcript.digest.chipErrors", { count: turn.errorCount })}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

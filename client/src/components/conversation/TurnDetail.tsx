/**
 * @file TurnDetail.tsx
 * @description Right pane of the digest view: the detail of one selected turn -
 * prompt, answer, and "how it got there" as an expandable list of steps, or the
 * full message list in "Everything" level.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Cpu,
  MessageSquare,
  Wrench,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ConversationTurn, TurnStep } from "../../lib/conversation-turns";
import type { TranscriptMessage } from "../../lib/types";
import { formatDateTime, formatDuration } from "../../lib/format";
import { MessageList } from "./MessageList";

/** Detail level: grouped steps or the full message stream. */
export type TurnDetailLevel = "steps" | "all";

/** Props for {@link TurnDetail}. */
interface TurnDetailProps {
  /** The selected turn. */
  turn: ConversationTurn;
  /** 1-based position of the turn among all loaded turns. */
  position: number;
  /** Total number of loaded turns. */
  total: number;
  /** Show a source chip per message (combined view). */
  showSource: boolean;
  /** Current detail level. */
  level: TurnDetailLevel;
  /** Change the detail level. */
  onLevelChange: (level: TurnDetailLevel) => void;
  /** Jump to the newer turn. */
  onNewer: () => void;
  /** Jump to the older turn. */
  onOlder: () => void;
  /** Whether a newer turn exists. */
  hasNewer: boolean;
  /** Whether an older turn exists. */
  hasOlder: boolean;
  /** Back to the outline (small screens only). */
  onBack: () => void;
}

/**
 * Total length of the text blocks in a message's content.
 *
 * @param message - The message whose text blocks are measured.
 * @returns The sum of `text` lengths over the `type === "text"` blocks.
 */
function promptTextLength(message: TranscriptMessage): number {
  return message.content.reduce(
    (sum, block) => sum + (block.type === "text" ? (block.text?.length ?? 0) : 0),
    0
  );
}

/** Icon for a step kind. */
function StepIcon({ kind }: { kind: TurnStep["kind"] }) {
  if (kind === "said") return <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />;
  if (kind === "tools") return <Wrench className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />;
  return <Cpu className="w-3.5 h-3.5 flex-shrink-0 text-amber-300" />;
}

/**
 * Render the detail of one turn: prompt, answer and the steps that led there,
 * or the full message list at the "Everything" level.
 *
 * @param props - The turn and navigation callbacks.
 * @returns The right digest pane.
 */
export function TurnDetail({
  turn,
  position,
  total,
  showSource,
  level,
  onLevelChange,
  onNewer,
  onOlder,
  hasNewer,
  hasOlder,
  onBack,
}: TurnDetailProps) {
  const { t } = useTranslation("sessions");
  const rootRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [promptOpen, setPromptOpen] = useState(false);

  // Reset expanded steps and scroll the pane back to the top when the turn changes.
  useEffect(() => {
    setExpanded(new Set());
    setPromptOpen(false);
    let el: HTMLElement | null = rootRef.current;
    while (el) {
      const style = window.getComputedStyle(el);
      if (style.overflowY === "auto" || style.overflowY === "scroll") {
        if (typeof el.scrollTo === "function") el.scrollTo({ top: 0 });
        break;
      }
      el = el.parentElement;
    }
  }, [turn.key]);

  const toggleStep = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const labelStyle = "mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-500";

  return (
    <div
      ref={rootRef}
      data-testid="turn-detail"
      className="rounded-lg border border-surface-3 bg-surface-1/50"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-surface-3 bg-surface-1 px-4 py-2.5 rounded-t-lg">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label={t("detail.transcript.digest.back")}
            className="lg:hidden inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-gray-400 hover:bg-surface-2 hover:text-gray-200"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {t("detail.transcript.digest.back")}
          </button>
          <span className="flex-shrink-0 text-xs font-medium text-gray-300">
            {t("detail.transcript.digest.position", { position, total })}
          </span>
          <span className="truncate text-[11px] text-gray-500">
            {turn.startedAt ? formatDateTime(turn.startedAt) : ""}
            {turn.startedAt && turn.endedAt && ` · ${formatDuration(turn.startedAt, turn.endedAt)}`}
          </span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <div className="flex items-center">
            <button
              type="button"
              onClick={onNewer}
              disabled={!hasNewer}
              aria-label={t("detail.transcript.digest.newer")}
              className="rounded-md p-1 text-gray-400 hover:bg-surface-2 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onOlder}
              disabled={!hasOlder}
              aria-label={t("detail.transcript.digest.older")}
              className="rounded-md p-1 text-gray-400 hover:bg-surface-2 hover:text-gray-200 disabled:opacity-40 disabled:hover:bg-transparent"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>
          <div
            className="inline-flex items-center rounded-md border border-surface-3 overflow-hidden"
            role="group"
            aria-label={t("detail.transcript.digest.levelSteps")}
          >
            <button
              type="button"
              onClick={() => onLevelChange("steps")}
              aria-pressed={level === "steps"}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 transition-colors ${
                level === "steps"
                  ? "bg-violet-500/20 text-violet-200"
                  : "bg-surface-2 text-gray-400 hover:text-gray-200"
              }`}
            >
              {t("detail.transcript.digest.levelSteps")}
            </button>
            <button
              type="button"
              onClick={() => onLevelChange("all")}
              aria-pressed={level === "all"}
              className={`inline-flex items-center gap-1.5 text-[11px] px-2 py-1 transition-colors border-l border-surface-3 ${
                level === "all"
                  ? "bg-violet-500/20 text-violet-200"
                  : "bg-surface-2 text-gray-400 hover:text-gray-200"
              }`}
            >
              {t("detail.transcript.digest.levelAll")}
            </button>
          </div>
        </div>
      </div>
      <div className="p-4 space-y-5">
        {level === "all" ? (
          <MessageList messages={turn.messages} loading={false} showSource={showSource} />
        ) : (
          <>
            <section>
              <h3 className={labelStyle}>{t("detail.transcript.digest.prompt")}</h3>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                {turn.partial ? (
                  <p className="text-sm text-gray-400">
                    {t("detail.transcript.digest.earlierHint")}
                  </p>
                ) : (
                  <>
                    {promptTextLength(turn.prompt!) > 600 && !promptOpen ? (
                      <div className="max-h-40 overflow-hidden">
                        <MessageList
                          messages={[turn.prompt!]}
                          loading={false}
                          showSource={showSource}
                        />
                      </div>
                    ) : (
                      <MessageList
                        messages={[turn.prompt!]}
                        loading={false}
                        showSource={showSource}
                      />
                    )}
                    {promptTextLength(turn.prompt!) > 600 && (
                      <button
                        type="button"
                        data-testid="prompt-toggle"
                        aria-expanded={promptOpen}
                        onClick={() => setPromptOpen((open) => !open)}
                        className="mt-2 text-[11px] text-blue-300 hover:text-blue-200"
                      >
                        {promptOpen
                          ? t("detail.transcript.digest.promptShowLess")
                          : t("detail.transcript.digest.promptShowAll")}
                      </button>
                    )}
                  </>
                )}
              </div>
            </section>
            <section>
              <h3 className={labelStyle}>{t("detail.transcript.digest.answer")}</h3>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
                {turn.answer ? (
                  <MessageList messages={[turn.answer]} loading={false} showSource={showSource} />
                ) : (
                  <p className="text-sm text-gray-500">{t("detail.transcript.digest.noAnswer")}</p>
                )}
              </div>
            </section>
            {turn.steps.length > 0 && (
              <section>
                <div className="mb-1.5 flex items-center justify-between">
                  <h3 className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                    {t("detail.transcript.digest.flow")} ·{" "}
                    {t("detail.transcript.digest.stepCount", { count: turn.steps.length })}
                  </h3>
                  {expanded.size > 0 && (
                    <button
                      type="button"
                      onClick={() => setExpanded(new Set())}
                      className="text-[11px] text-gray-500 hover:text-gray-300"
                    >
                      {t("detail.transcript.digest.collapseAll")}
                    </button>
                  )}
                </div>
                <div className="space-y-1.5 border-l-2 border-surface-3 pl-3">
                  {turn.steps.map((step) => {
                    const open = expanded.has(step.key);
                    return (
                      <div key={step.key}>
                        <button
                          type="button"
                          data-testid="turn-step"
                          aria-expanded={open}
                          onClick={() => toggleStep(step.key)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface-2 ${
                            step.kind === "agent" ? "border border-amber-500/30 bg-amber-500/5" : ""
                          }`}
                        >
                          <StepIcon kind={step.kind} />
                          <span className="min-w-0 flex-1 truncate text-gray-300">
                            {step.kind === "tools" && step.label === ""
                              ? t("detail.transcript.digest.thinking")
                              : step.label}
                          </span>
                          {step.kind === "agent" && (
                            <span className="flex-shrink-0 text-[11px] text-gray-500">
                              {t("detail.transcript.digest.stepMessages", {
                                count: step.messages.length,
                              })}
                            </span>
                          )}
                          {step.errorCount > 0 && (
                            <span className="flex-shrink-0 text-[11px] text-red-300">
                              {t("detail.transcript.digest.stepFailed", { count: step.errorCount })}
                            </span>
                          )}
                          {open ? (
                            <ChevronDown className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 text-gray-500" />
                          )}
                        </button>
                        {open && (
                          <div className="mt-2 mb-3 pl-2">
                            <MessageList
                              messages={step.messages}
                              loading={false}
                              showSource={showSource}
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

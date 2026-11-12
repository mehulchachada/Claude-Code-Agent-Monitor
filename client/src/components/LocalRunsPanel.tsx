/**
 * @file LocalRunsPanel.tsx
 * @description Panel on the session detail Agents tab that highlights the cost
 * saved by running local models, with per-task groups, per-run steps, token
 * usage and durations.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useState } from "react";
import { ChevronDown, ChevronRight, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../lib/types";
import { fmt, fmtCost, formatMs } from "../lib/format";
import { barPercent, extraSharePercent } from "../lib/run-savings";
import type { RunGroup, RunRow } from "../lib/run-savings";
import { useRunSummary } from "../lib/useRunSummary";

interface LocalRunsPanelProps {
  agents: Agent[];
  comparisonModel: string | null; // the session's model
  sessionCost?: number | null; // the session's real Claude cost in USD
}

export function LocalRunsPanel({ agents, comparisonModel, sessionCost }: LocalRunsPanelProps) {
  const { t } = useTranslation("sessions");
  const { summary, model } = useRunSummary(agents, comparisonModel);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  if (summary.runCount === 0) return null;

  const total = summary.inputTokens + summary.outputTokens;
  const hasCost = summary.claudeCost !== null;
  const totalCost = summary.claudeCost ?? 0;

  const isOpen = (group: RunGroup) => expanded.has(group.key) || group.rows.some((r) => r.running);
  const allOpen = summary.groups.every((g) => isOpen(g));
  const toggleAll = () =>
    setExpanded(allOpen ? new Set() : new Set(summary.groups.map((g) => g.key)));
  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <section data-testid="local-runs-panel" className="mb-6">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Timer className="w-3.5 h-3.5 text-violet-400" />
        {t("detail.localRuns.title")}
        <span className="text-gray-600 font-mono">· {summary.runCount}</span>
        <button
          type="button"
          data-testid="local-runs-toggle-all"
          className="ml-auto text-[11px] font-normal normal-case tracking-normal text-gray-500 hover:text-gray-300"
          onClick={toggleAll}
        >
          {allOpen ? t("detail.localRuns.collapseAll") : t("detail.localRuns.expandAll")}
        </button>
      </h3>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <div
          data-testid="local-runs-saved"
          className="col-span-2 lg:col-span-1 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4"
        >
          <p className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300">
            {t("detail.localRuns.savedLabel")}
          </p>
          <p
            data-testid="local-runs-total-saved"
            className="mt-1 font-mono text-4xl font-bold tracking-tight text-emerald-300"
          >
            {hasCost ? fmtCost(totalCost) : "—"}
          </p>
          {hasCost && typeof sessionCost === "number" && sessionCost > 0 ? (
            <p data-testid="local-runs-context" className="mt-1.5 text-xs text-emerald-200">
              {t("detail.localRuns.context", {
                spent: fmtCost(sessionCost),
                total: fmtCost(sessionCost + totalCost),
                percent: extraSharePercent(totalCost, sessionCost),
              })}
            </p>
          ) : null}
          {hasCost ? (
            <div className="mt-3 space-y-1.5 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-32 flex-shrink-0 truncate text-gray-300">{model}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-4">
                  <span
                    className="block h-full rounded-full bg-violet-400"
                    style={{ width: "100%" }}
                  />
                </span>
                <span className="w-20 flex-shrink-0 text-right font-mono text-gray-200">
                  {fmtCost(totalCost)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-32 flex-shrink-0 truncate text-gray-300">
                  {t("detail.localRuns.localLabel")}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-4">
                  <span
                    className="block h-full rounded-full bg-emerald-400"
                    style={{ width: "3px" }}
                  />
                </span>
                <span className="w-20 flex-shrink-0 text-right font-mono text-emerald-300">
                  {fmtCost(0)}
                </span>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-400">{t("detail.localRuns.noPrice", { model })}</p>
          )}
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {t("detail.localRuns.tokensLabel")}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-gray-100">{fmt(total)}</p>
          <p className="mt-1 text-xs text-gray-500">
            {t("detail.localRuns.tokens", {
              input: fmt(summary.inputTokens),
              output: fmt(summary.outputTokens),
            })}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {t("detail.localRuns.timeLabel")}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-gray-100">
            {formatMs(summary.durationMs)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {t("detail.localRuns.avgPerRun", {
              time: formatMs(summary.durationMs / summary.runCount),
            })}
          </p>
        </div>

        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            {t("detail.localRuns.runsLabel")}
          </p>
          <p className="mt-1 font-mono text-2xl font-bold text-gray-100">{summary.runCount}</p>
          <p className="mt-1 text-xs text-gray-500">
            {t("detail.localRuns.taskCount", { count: summary.taskCount })}
            {summary.failedCount > 0 && (
              <>
                {" · "}
                <span className="text-red-300">
                  {t("detail.localRuns.failedCount", { count: summary.failedCount })}
                </span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-500">
              <th className="px-3 py-2 text-left font-medium whitespace-nowrap">
                {t("detail.localRuns.colTask")}
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {t("detail.localRuns.colRuns")}
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {t("detail.localRuns.colTime")}
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {t("detail.localRuns.colTokens")}
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                {t("detail.localRuns.colSaved")}
              </th>
            </tr>
          </thead>
          <tbody>
            {summary.groups.map((group) => {
              const open = isOpen(group);
              return (
                <GroupRows
                  key={group.key}
                  group={group}
                  open={open}
                  onToggle={() => toggle(group.key)}
                  maxCost={summary.maxGroupCost}
                  t={t}
                />
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-1.5 text-[11px] text-gray-500">
        {summary.pricing
          ? t("detail.localRuns.estimateNote", { model })
          : t("detail.localRuns.noPrice", { model })}
      </p>
    </section>
  );
}

function GroupRows({
  group,
  open,
  onToggle,
  maxCost,
  t,
}: {
  group: RunGroup;
  open: boolean;
  onToggle: () => void;
  maxCost: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <tr
        data-testid="local-run-group"
        aria-expanded={open}
        onClick={onToggle}
        className="cursor-pointer border-t border-border hover:bg-surface-4/50"
      >
        <td className="w-full max-w-0 px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2">
            {open ? (
              <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-gray-500" />
            )}
            <span className="truncate font-semibold text-gray-100">
              {group.label ?? t("detail.localRuns.otherRuns")}
            </span>
            {group.failedCount > 0 && (
              <span className="flex-shrink-0 rounded border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-300">
                {t("detail.localRuns.failedCount", { count: group.failedCount })}
              </span>
            )}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right font-mono text-xs text-gray-400">
          {group.rows.length}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-gray-300">
          {formatMs(group.durationMs)}
        </td>
        <td
          className="whitespace-nowrap px-3 py-2.5 text-right font-mono text-xs text-gray-300"
          title={t("detail.localRuns.tokens", {
            input: fmt(group.inputTokens),
            output: fmt(group.outputTokens),
          })}
        >
          {fmt(group.inputTokens + group.outputTokens)}
        </td>
        <td className="whitespace-nowrap px-3 py-2.5">
          <SavedCell cost={group.claudeCost} max={maxCost} strong />
        </td>
      </tr>
      {open && group.rows.map((row) => <StepRow key={row.id} row={row} maxCost={maxCost} t={t} />)}
    </>
  );
}

function StepRow({
  row,
  maxCost,
  t,
}: {
  row: RunRow;
  maxCost: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const dotClass = row.running
    ? "bg-emerald-400 animate-pulse"
    : row.status === "error"
      ? "bg-red-400"
      : "bg-gray-500";
  return (
    <tr data-testid="local-run-row" className="border-t border-border/60 bg-surface-2/40">
      <td className="w-full max-w-0 py-1.5 pl-9 pr-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="w-16 flex-shrink-0 font-mono text-[11px] text-gray-500">
            {row.step ?? ""}
          </span>
          <span className={"h-1.5 w-1.5 flex-shrink-0 rounded-full " + dotClass} />
          <span className="truncate text-[13px] text-gray-300" title={row.name}>
            {row.name}
          </span>
        </span>
      </td>
      <td />
      <td className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-gray-300">
        {row.durationMs === null ? "—" : formatMs(row.durationMs)}
      </td>
      <td
        className="whitespace-nowrap px-3 py-1.5 text-right font-mono text-xs text-gray-300"
        title={
          row.inputTokens === null || row.outputTokens === null
            ? undefined
            : t("detail.localRuns.tokens", {
                input: fmt(row.inputTokens),
                output: fmt(row.outputTokens),
              })
        }
      >
        {row.inputTokens === null || row.outputTokens === null
          ? "—"
          : fmt(row.inputTokens + row.outputTokens)}
      </td>
      <td className="whitespace-nowrap px-3 py-1.5">
        <SavedCell cost={row.claudeCost} max={maxCost} strong={false} />
      </td>
    </tr>
  );
}

function SavedCell({ cost, max, strong }: { cost: number | null; max: number; strong: boolean }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="hidden h-1.5 w-28 overflow-hidden rounded-full bg-surface-4 sm:block">
        <span
          className={
            "block h-full rounded-full " + (strong ? "bg-emerald-400" : "bg-emerald-400/60")
          }
          style={{ width: `${barPercent(cost, max)}%` }}
        />
      </span>
      <span
        className={
          "w-16 text-right font-mono text-emerald-300 " +
          (strong ? "text-sm font-semibold" : "text-xs")
        }
      >
        {cost === null ? "—" : fmtCost(cost)}
      </span>
    </span>
  );
}

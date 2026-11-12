/**
 * @file LocalSavingsChip.tsx
 * @description Small header chip that shows how much a session saved by
 * running local models, next to the session's own cost.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { PiggyBank } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Agent } from "../lib/types";
import { fmtCost } from "../lib/format";
import { useRunSummary } from "../lib/useRunSummary";

interface LocalSavingsChipProps {
  agents: Agent[];
  comparisonModel: string | null;
}

export function LocalSavingsChip({ agents, comparisonModel }: LocalSavingsChipProps) {
  const { t } = useTranslation("sessions");
  const { summary, model } = useRunSummary(agents, comparisonModel);

  if (summary.claudeCost === null || summary.claudeCost <= 0) return null;

  return (
    <span
      data-testid="local-savings-chip"
      title={t("detail.localRuns.chipTitle", { model })}
      className="inline-flex items-center gap-1.5 rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-300"
    >
      <PiggyBank className="h-3 w-3" />
      {t("detail.localRuns.chip", { amount: fmtCost(summary.claudeCost) })}
    </span>
  );
}

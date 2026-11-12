/**
 * @file useRunSummary.ts
 * @description Hook that gathers the local-model (external) run data for a
 * session: fetches model pricing, keeps a ticking clock while a run is in
 * flight, and returns the summarised runs plus the comparison model name.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useEffect, useMemo, useState } from "react";
import type { Agent, ModelPricing } from "./types";
import { api } from "./api";
import { formatModelName } from "./format";
import { summariseRuns } from "./run-savings";
import type { RunSummary } from "./run-savings";

export function useRunSummary(
  agents: Agent[],
  comparisonModel: string | null
): { summary: RunSummary; model: string } {
  const [rules, setRules] = useState<ModelPricing[]>([]);
  const [now, setNow] = useState<number>(() => Date.now());

  const hasRuns = useMemo(() => agents.some((a) => a.subagent_type === "external"), [agents]);

  useEffect(() => {
    if (!hasRuns) return;
    let mounted = true;
    try {
      api.pricing
        .list()
        .then((res) => {
          if (mounted) setRules(res.pricing);
        })
        .catch(() => {});
    } catch {
      // a failure simply leaves no cost
    }
    return () => {
      mounted = false;
    };
  }, [hasRuns]);

  const summary = useMemo(
    () => summariseRuns(agents, comparisonModel, rules, now),
    [agents, comparisonModel, rules, now]
  );

  const anyRunning = useMemo(
    () => summary.groups.some((g) => g.rows.some((r) => r.running)),
    [summary]
  );

  useEffect(() => {
    if (!anyRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [anyRunning]);

  const model = formatModelName(comparisonModel) ?? comparisonModel ?? "";

  return { summary, model };
}

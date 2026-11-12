/**
 * @file run-savings.ts
 * @description Pure helpers that turn external (local-model) agent rows into
 * per-run and per-group summaries: duration, token usage and the cost the same
 * tokens would have incurred on the orchestrating Claude model.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import type { Agent, AgentStatus, ModelPricing } from "./types";
import { EXTERNAL_SUBAGENT_TYPE, externalRunInfo } from "./external-run";
import type { ExternalRunStats } from "./external-run";

export interface RunRow {
  id: string; // agent id
  name: string; // agent name
  status: AgentStatus;
  group: string | null;
  step: string | null;
  running: boolean; // status === "working" and no ended_at
  failed: boolean; // status === "error"
  durationMs: number | null;
  inputTokens: number | null; // fresh + cached; null when the run has no stats
  outputTokens: number | null;
  claudeCost: number | null; // USD; null without stats or without a price
}

export interface RunGroup {
  key: string; // the group name, or "" for runs without a group
  label: string | null; // the group name, or null for the "" group
  rows: RunRow[];
  failedCount: number; // rows with failed
  durationMs: number; // sums over rows, null values count as 0
  inputTokens: number;
  outputTokens: number;
  claudeCost: number | null; // null when no row has a cost
}

export interface RunSummary {
  groups: RunGroup[];
  runCount: number;
  failedCount: number; // all failed rows
  taskCount: number; // groups whose label is not null
  maxGroupCost: number; // largest claudeCost of any group, nulls as 0; 0 when no groups
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  claudeCost: number | null;
  pricing: ModelPricing | null; // the rule used for the comparison
}

/** Width of a bar, in percent, for `value` on a scale whose largest value is `max`. */
export function barPercent(value: number | null, max: number): number {
  if (value === null || value <= 0 || max <= 0) return 0;
  return Math.min(100, Math.max(2, Math.round((value / max) * 100)));
}

/** How much larger the bill would have been without the local runs, in whole percent. */
export function extraSharePercent(saved: number | null, spent: number | null): number {
  if (saved === null || saved <= 0 || spent === null || spent <= 0) return 0;
  return Math.round((saved / spent) * 100);
}

/**
 * Find the pricing rule for a model id. `model_pattern` is SQL LIKE style:
 * `%` matches any text, everything else is literal; the match must cover the
 * whole id and is case-insensitive. Among matching rules the one with the
 * longest pattern wins.
 */
export function matchPricing(model: string | null, rules: ModelPricing[]): ModelPricing | null {
  if (!model) return null;
  let best: ModelPricing | null = null;
  for (const rule of rules) {
    const regex = new RegExp(
      "^" +
        rule.model_pattern
          .split("%")
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join(".*") +
        "$",
      "i"
    );
    if (!regex.test(model)) continue;
    if (!best || rule.model_pattern.length > best.model_pattern.length) best = rule;
  }
  return best;
}

/** USD cost of the run's tokens at the given model's rates; null fields count as 0. */
export function claudeEquivalentCost(stats: ExternalRunStats, pricing: ModelPricing): number {
  const input = stats.input_tokens ?? 0;
  const cached = stats.cached_input_tokens ?? 0;
  const output = stats.output_tokens ?? 0;
  return (
    (input * pricing.input_per_mtok +
      cached * pricing.cache_read_per_mtok +
      output * pricing.output_per_mtok) /
    1_000_000
  );
}

/** A run's display name: the brief's title without markdown heading marks. */
export function displayRunName(name: string): string {
  const cleaned = name.replace(/^#+\s*/, "").trim();
  return cleaned === "" ? name.trim() : cleaned;
}

function parseTime(value: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}

function durationMsOf(agent: Agent, stats: ExternalRunStats | null, now: number): number | null {
  if (stats && stats.wall_s !== null) {
    return Math.max(0, stats.wall_s * 1000);
  }
  const started = parseTime(agent.started_at);
  if (started === null) return null;
  const ended = parseTime(agent.ended_at);
  if (ended !== null) return Math.max(0, ended - started);
  if (agent.status === "working" && !agent.ended_at) return Math.max(0, now - started);
  return null;
}

/**
 * Summarise the external runs among `agents`: per-run rows grouped by their
 * `group` field, with totals and the Claude-equivalent cost when a pricing
 * rule matches `comparisonModel`.
 */
export function summariseRuns(
  agents: Agent[],
  comparisonModel: string | null,
  rules: ModelPricing[],
  now: number
): RunSummary {
  const pricing = matchPricing(comparisonModel, rules);

  const rows: RunRow[] = [];
  const startedAt = new Map<string, number | null>();
  for (const agent of agents) {
    if (agent.subagent_type !== EXTERNAL_SUBAGENT_TYPE) continue;
    const info = externalRunInfo(agent.metadata);
    if (!info) continue;
    const stats = info.stats;
    const running = agent.status === "working" && !agent.ended_at;
    const row: RunRow = {
      id: agent.id,
      name: displayRunName(agent.name),
      status: agent.status,
      group: info.group,
      step: info.step,
      running,
      failed: agent.status === "error",
      durationMs: durationMsOf(agent, stats, now),
      inputTokens: stats ? (stats.input_tokens ?? 0) + (stats.cached_input_tokens ?? 0) : null,
      outputTokens: stats ? (stats.output_tokens ?? 0) : null,
      claudeCost: stats && pricing ? claudeEquivalentCost(stats, pricing) : null,
    };
    rows.push(row);
    startedAt.set(agent.id, parseTime(agent.started_at));
  }

  const groups = new Map<string, RunGroup>();
  for (const row of rows) {
    const key = row.group ?? "";
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        label: key === "" ? null : key,
        rows: [],
        failedCount: 0,
        durationMs: 0,
        inputTokens: 0,
        outputTokens: 0,
        claudeCost: null,
      };
      groups.set(key, group);
    }
    group.rows.push(row);
    if (row.failed) group.failedCount += 1;
    group.durationMs += row.durationMs ?? 0;
    group.inputTokens += row.inputTokens ?? 0;
    group.outputTokens += row.outputTokens ?? 0;
    if (row.claudeCost !== null) {
      group.claudeCost = (group.claudeCost ?? 0) + row.claudeCost;
    }
  }

  const earliest = (group: RunGroup): number =>
    group.rows.reduce((min, r) => {
      const s = startedAt.get(r.id);
      return s !== null && s !== undefined ? Math.min(min, s) : min;
    }, Infinity);
  const ordered = [...groups.values()].sort((a, b) => {
    const aEmpty = a.key === "";
    const bEmpty = b.key === "";
    if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
    const aStart = earliest(a);
    const bStart = earliest(b);
    if (aStart !== bStart) return aStart - bStart;
    return a.key.localeCompare(b.key);
  });
  for (const group of ordered) {
    group.rows.sort((a, b) => (startedAt.get(a.id) ?? 0) - (startedAt.get(b.id) ?? 0));
  }

  const runCount = rows.length;
  const failedCount = rows.reduce((sum, r) => sum + (r.failed ? 1 : 0), 0);
  const taskCount = ordered.reduce((sum, g) => sum + (g.label !== null ? 1 : 0), 0);
  const maxGroupCost = ordered.reduce((max, g) => Math.max(max, g.claudeCost ?? 0), 0);
  const durationMs = rows.reduce((sum, r) => sum + (r.durationMs ?? 0), 0);
  const inputTokens = rows.reduce((sum, r) => sum + (r.inputTokens ?? 0), 0);
  const outputTokens = rows.reduce((sum, r) => sum + (r.outputTokens ?? 0), 0);
  const claudeCost = rows.some((r) => r.claudeCost !== null)
    ? rows.reduce((sum, r) => sum + (r.claudeCost ?? 0), 0)
    : null;

  return {
    groups: ordered,
    runCount,
    failedCount,
    taskCount,
    maxGroupCost,
    durationMs,
    inputTokens,
    outputTokens,
    claudeCost,
    pricing,
  };
}

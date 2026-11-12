/**
 * @file run-savings.test.ts
 * @description Verifies pricing-pattern matching, the Claude-equivalent cost
 * formula, run durations, and the grouping/ordering/totals of summariseRuns.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import type { Agent, ModelPricing } from "../types";
import {
  barPercent,
  claudeEquivalentCost,
  extraSharePercent,
  displayRunName,
  matchPricing,
  summariseRuns,
} from "../run-savings";

const pricing = (pattern: string, input = 3, output = 15, cacheRead = 0.3): ModelPricing => ({
  model_pattern: pattern,
  display_name: pattern,
  input_per_mtok: input,
  output_per_mtok: output,
  cache_read_per_mtok: cacheRead,
  cache_write_per_mtok: 0,
  cache_write_1h_per_mtok: 0,
  fast_input_per_mtok: 0,
  fast_output_per_mtok: 0,
  updated_at: "2025-01-01T00:00:00.000Z",
});

const agent = (over: Partial<Agent>): Agent => ({
  id: "a1",
  session_id: "s1",
  name: "run",
  type: "subagent",
  status: "completed",
  subagent_type: "external",
  task: null,
  current_tool: null,
  started_at: "2025-01-01T00:00:00.000Z",
  ended_at: "2025-01-01T00:01:00.000Z",
  updated_at: "2025-01-01T00:01:00.000Z",
  parent_agent_id: null,
  metadata: JSON.stringify({ external: { run_id: "job" } }),
  ...over,
});

describe("matchPricing", () => {
  const rules = [pricing("claude-%", 3, 15), pricing("claude-opus-4%", 15, 75)];

  it("matches a wildcard pattern against the whole model id", () => {
    expect(matchPricing("claude-opus-4-20250101", rules)?.model_pattern).toBe("claude-opus-4%");
    expect(matchPricing("claude-haiku-4-5", rules)?.model_pattern).toBe("claude-%");
  });

  it("prefers the longest matching pattern", () => {
    expect(matchPricing("claude-opus-4-20250101", rules)?.display_name).toBe("claude-opus-4%");
  });

  it("is case-insensitive and does not match partial ids", () => {
    expect(matchPricing("CLAUDE-OPUS-4-20250101", rules)).not.toBeNull();
    expect(matchPricing("xclaude-opus-4", rules)).toBeNull();
    expect(matchPricing("gpt-5", rules)).toBeNull();
  });

  it("returns null for a null model or no match", () => {
    expect(matchPricing(null, rules)).toBeNull();
    expect(matchPricing("gpt-5", rules)).toBeNull();
    expect(matchPricing("claude-opus-4", [])).toBeNull();
  });

  it("treats non-wildcard characters literally", () => {
    expect(matchPricing("claude.a", [pricing("claude.a")])).not.toBeNull();
    expect(matchPricing("claudexa", [pricing("claude.a")])).toBeNull();
  });
});

describe("claudeEquivalentCost", () => {
  it("applies input, cache-read and output rates per million tokens", () => {
    // 1M input * $3 + 2M cache * $0.3 + 0.5M output * $15 = 3 + 0.6 + 7.5 = 11.1
    const cost = claudeEquivalentCost(
      {
        wall_s: null,
        turns: null,
        input_tokens: 1_000_000,
        cached_input_tokens: 2_000_000,
        output_tokens: 500_000,
        tool_calls: null,
        checks: null,
      },
      pricing("claude-%", 3, 15, 0.3)
    );
    expect(cost).toBeCloseTo(11.1, 6);
  });

  it("counts null token fields as zero", () => {
    const cost = claudeEquivalentCost(
      {
        wall_s: null,
        turns: null,
        input_tokens: null,
        cached_input_tokens: null,
        output_tokens: 1_000_000,
        tool_calls: null,
        checks: null,
      },
      pricing("claude-%", 3, 15, 0.3)
    );
    expect(cost).toBeCloseTo(15, 6);
  });
});

describe("displayRunName", () => {
  it("strips leading markdown heading marks and surrounding whitespace", () => {
    expect(displayRunName("# Digest v2, step 1")).toBe("Digest v2, step 1");
    expect(displayRunName("## Part A")).toBe("Part A");
    expect(displayRunName("#   Spaced  ")).toBe("Spaced");
  });

  it("keeps plain names and a bare heading mark unchanged", () => {
    expect(displayRunName("plain")).toBe("plain");
    expect(displayRunName("#")).toBe("#");
    expect(displayRunName("  plain  ")).toBe("plain");
  });

  it("does not touch heading marks in the middle of the name", () => {
    expect(displayRunName("step #1 of 3")).toBe("step #1 of 3");
  });
});

describe("barPercent", () => {
  it("returns 0 for null, zero values or a non-positive max", () => {
    expect(barPercent(null, 10)).toBe(0);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(-5, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(5, -1)).toBe(0);
  });

  it("clamps tiny values to the minimum of 2", () => {
    expect(barPercent(0.001, 10)).toBe(2);
  });

  it("scales values against the max", () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
  });

  it("clamps values above the max to 100", () => {
    expect(barPercent(11, 10)).toBe(100);
  });
});

describe("extraSharePercent", () => {
  it("returns 0 for null or non-positive inputs", () => {
    expect(extraSharePercent(null, 100)).toBe(0);
    expect(extraSharePercent(0, 100)).toBe(0);
    expect(extraSharePercent(-5, 100)).toBe(0);
    expect(extraSharePercent(10, null)).toBe(0);
    expect(extraSharePercent(10, 0)).toBe(0);
    expect(extraSharePercent(10, -1)).toBe(0);
  });

  it("rounds the saving as a share of the spend to whole percent", () => {
    expect(extraSharePercent(46.39, 277.74)).toBe(17);
    expect(extraSharePercent(50, 100)).toBe(50);
  });
});

describe("summariseRuns", () => {
  const rules = [pricing("claude-%", 3, 15, 0.3)];
  const now = Date.parse("2025-01-01T01:00:00.000Z");

  it("computes duration from stats wall_s, then ended_at, then now, else null", () => {
    const withWall = agent({
      metadata: JSON.stringify({
        external: { run_id: "j", stats: { wall_s: 90 } },
      }),
    });
    expect(
      summariseRuns([withWall], "claude-opus-4", rules, now).groups[0]?.rows[0]?.durationMs
    ).toBe(90_000);

    const withEnd = agent({
      started_at: "2025-01-01T00:00:00.000Z",
      ended_at: "2025-01-01T00:02:30.000Z",
    });
    expect(
      summariseRuns([withEnd], "claude-opus-4", rules, now).groups[0]?.rows[0]?.durationMs
    ).toBe(150_000);

    const running = agent({
      status: "working",
      ended_at: null,
      started_at: "2025-01-01T00:59:00.000Z",
    });
    expect(
      summariseRuns([running], "claude-opus-4", rules, now).groups[0]?.rows[0]?.durationMs
    ).toBe(60_000);

    const idle = agent({
      status: "waiting",
      ended_at: null,
    });
    expect(
      summariseRuns([idle], "claude-opus-4", rules, now).groups[0]?.rows[0]?.durationMs
    ).toBeNull();
  });

  it("groups runs, orders rows and groups by started_at, and puts ungrouped last", () => {
    const a = agent({
      id: "a",
      name: "a",
      started_at: "2025-01-01T00:05:00.000Z",
      metadata: JSON.stringify({
        external: { run_id: "a", group: "digest", step: "2/3" },
      }),
    });
    const b = agent({
      id: "b",
      name: "b",
      started_at: "2025-01-01T00:01:00.000Z",
      metadata: JSON.stringify({
        external: { run_id: "b", group: "digest", step: "1/3" },
      }),
    });
    const c = agent({
      id: "c",
      name: "c",
      started_at: "2025-01-01T00:00:00.000Z",
      metadata: JSON.stringify({ external: { run_id: "c", group: "other" } }),
    });
    const d = agent({
      id: "d",
      name: "d",
      started_at: "2025-01-01T00:02:00.000Z",
      metadata: JSON.stringify({ external: { run_id: "d" } }),
    });

    const summary = summariseRuns([a, b, c, d], "claude-opus-4", rules, now);
    expect(summary.groups.map((g) => g.key)).toEqual(["other", "digest", ""]);
    expect(summary.groups[1]?.rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(summary.groups[0]?.label).toBe("other");
    expect(summary.groups[2]?.label).toBeNull();
  });

  it("sums totals and gives each row a Claude cost", () => {
    const stats = {
      wall_s: 10,
      turns: 2,
      input_tokens: 1_000_000,
      cached_input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      tool_calls: 1,
      checks: 1,
    };
    const mk = (id: string): Agent =>
      agent({
        id,
        metadata: JSON.stringify({ external: { run_id: id, stats } }),
      });
    const summary = summariseRuns([mk("x"), mk("y")], "claude-opus-4", rules, now);
    // per run: 1M*3 + 1M*0.3 + 1M*15 = 18.3
    expect(summary.claudeCost).toBeCloseTo(36.6, 6);
    expect(summary.inputTokens).toBe(4_000_000);
    expect(summary.outputTokens).toBe(2_000_000);
    expect(summary.runCount).toBe(2);
    expect(summary.pricing?.model_pattern).toBe("claude-%");
  });

  it("leaves costs null when the model has no price", () => {
    const withStats = agent({
      metadata: JSON.stringify({
        external: {
          run_id: "j",
          stats: { input_tokens: 1000, output_tokens: 500 },
        },
      }),
    });
    const summary = summariseRuns([withStats], "gpt-5", rules, now);
    expect(summary.claudeCost).toBeNull();
    expect(summary.groups[0]?.claudeCost).toBeNull();
    expect(summary.groups[0]?.rows[0]?.claudeCost).toBeNull();
    expect(summary.pricing).toBeNull();
  });

  it("flags failed rows and counts them per group and overall", () => {
    const ok = agent({ id: "ok", status: "completed" });
    const failed = agent({ id: "bad", status: "error" });
    const failedOther = agent({
      id: "bad2",
      status: "error",
      metadata: JSON.stringify({ external: { run_id: "bad2", group: "other" } }),
    });
    const summary = summariseRuns([ok, failed, failedOther], "claude-opus-4", rules, now);
    expect(summary.failedCount).toBe(2);
    const ungrouped = summary.groups.find((g) => g.label === null);
    const other = summary.groups.find((g) => g.label === "other");
    expect(ungrouped?.failedCount).toBe(1);
    expect(other?.failedCount).toBe(1);
    expect(ungrouped?.rows[0]?.failed).toBe(false);
    expect(ungrouped?.rows[1]?.failed).toBe(true);
  });

  it("counts tasks (labelled groups) and the largest group cost", () => {
    const stats = {
      wall_s: 1,
      turns: 1,
      input_tokens: 1_000_000,
      cached_input_tokens: 0,
      output_tokens: 0,
      tool_calls: 0,
      checks: 0,
    };
    const big = agent({
      id: "big",
      metadata: JSON.stringify({
        external: { run_id: "big", group: "big", stats },
      }),
    });
    const small = agent({
      id: "small",
      metadata: JSON.stringify({
        external: { run_id: "small", group: "small", stats: { ...stats, input_tokens: 100 } },
      }),
    });
    const loose = agent({
      id: "loose",
      metadata: JSON.stringify({ external: { run_id: "loose" } }),
    });
    const summary = summariseRuns([big, small, loose], "claude-opus-4", rules, now);
    expect(summary.taskCount).toBe(2);
    // 1M input * $3 = 3.0 for the "big" group; the loose run has no cost
    expect(summary.maxGroupCost).toBeCloseTo(3, 6);
  });

  it("gives maxGroupCost 0 when there are no groups", () => {
    const summary = summariseRuns([], "claude-opus-4", rules, now);
    expect(summary.maxGroupCost).toBe(0);
    expect(summary.taskCount).toBe(0);
    expect(summary.failedCount).toBe(0);
  });

  it("ignores non-external agents and external rows without a run block", () => {
    const plain = agent({ subagent_type: "researcher" });
    const noBlock = agent({ metadata: JSON.stringify({ model: "qwen" }) });
    const summary = summariseRuns([plain, noBlock], "claude-opus-4", rules, now);
    expect(summary.runCount).toBe(0);
    expect(summary.groups).toEqual([]);
  });
});

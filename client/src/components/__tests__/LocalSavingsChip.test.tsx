/**
 * @file LocalSavingsChip.test.tsx
 * @description Verifies the header savings chip: hidden without external
 * runs or without a matching price, and shown with the formatted amount
 * once pricing resolves.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { Agent, ModelPricing } from "../../lib/types";
import i18n from "../../i18n";

const listMock = vi.fn();
vi.mock("../../lib/api", () => ({
  api: {
    pricing: {
      list: () => listMock(),
    },
  },
}));

import { LocalSavingsChip } from "../LocalSavingsChip";

const pricing = (pattern: string): ModelPricing => ({
  model_pattern: pattern,
  display_name: pattern,
  input_per_mtok: 3,
  output_per_mtok: 15,
  cache_read_per_mtok: 0.3,
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

const stats = {
  wall_s: 60,
  turns: 2,
  input_tokens: 1_000_000,
  cached_input_tokens: 0,
  output_tokens: 1_000_000,
  tool_calls: 1,
  checks: 1,
};

describe("LocalSavingsChip", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({ pricing: [pricing("claude-%")] });
    await i18n.changeLanguage("en");
  });

  it("renders nothing without external runs", () => {
    render(
      <LocalSavingsChip
        agents={[agent({ subagent_type: "researcher" })]}
        comparisonModel="claude-opus-4"
      />
    );
    expect(screen.queryByTestId("local-savings-chip")).toBeNull();
  });

  it("renders nothing when no pricing rule matches", async () => {
    listMock.mockResolvedValue({ pricing: [pricing("gpt-%")] });
    const a = agent({
      metadata: JSON.stringify({
        external: { run_id: "a", stats: { input_tokens: 1000, output_tokens: 500 } },
      }),
    });
    render(<LocalSavingsChip agents={[a]} comparisonModel="claude-opus-4" />);
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(screen.queryByTestId("local-savings-chip")).toBeNull();
  });

  it("shows the formatted saved amount once pricing resolves", async () => {
    const a = agent({
      metadata: JSON.stringify({ external: { run_id: "a", stats } }),
    });
    render(<LocalSavingsChip agents={[a]} comparisonModel="claude-opus-4" />);

    // 1M in * 3 + 1M out * 15 = 18.0
    const chip = await screen.findByTestId("local-savings-chip");
    expect(chip).toHaveTextContent("$18.00");
    expect(chip).toHaveTextContent("saved locally");
    expect(chip).toHaveAttribute(
      "title",
      "Estimated cost of this session's local-model runs on Claude Opus 4"
    );
  });
});

/**
 * @file LocalRunsPanel.test.tsx
 * @description Verifies the local-runs panel: empty state, collapsed task
 * groups, expanding groups (click and toggle-all), the hero saved amount once
 * pricing resolves, the no-price state, and auto-opened running groups.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { LocalRunsPanel } from "../LocalRunsPanel";

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

describe("LocalRunsPanel", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    listMock.mockResolvedValue({ pricing: [pricing("claude-%")] });
    await i18n.changeLanguage("en");
  });

  it("renders nothing without external runs", () => {
    const { container } = render(
      <LocalRunsPanel
        agents={[agent({ subagent_type: "researcher" })]}
        comparisonModel="claude-opus-4"
      />
    );
    expect(screen.queryByTestId("local-runs-panel")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows one collapsed row per task group and no steps until a group is clicked", async () => {
    const a = agent({
      id: "a",
      name: "digest step 1",
      started_at: "2025-01-01T00:00:00.000Z",
      metadata: JSON.stringify({
        external: { run_id: "a", group: "digest-v2", step: "1/2", stats },
      }),
    });
    const b = agent({
      id: "b",
      name: "digest step 2",
      started_at: "2025-01-01T00:05:00.000Z",
      metadata: JSON.stringify({
        external: { run_id: "b", group: "digest-v2", step: "2/2", stats },
      }),
    });
    const c = agent({
      id: "c",
      name: "loose run",
      started_at: "2025-01-01T00:10:00.000Z",
      metadata: JSON.stringify({ external: { run_id: "c", stats } }),
    });

    const user = userEvent.setup();
    render(<LocalRunsPanel agents={[a, b, c]} comparisonModel="claude-opus-4" />);

    const groups = screen.getAllByTestId("local-run-group");
    expect(groups).toHaveLength(2); // digest-v2 + the ungrouped run's own group
    expect(screen.queryAllByTestId("local-run-row")).toHaveLength(0);
    expect(groups[0]!).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("digest-v2")).toBeInTheDocument();
    expect(screen.getByText("Other runs")).toBeInTheDocument();

    // clicking a group opens it and shows its step rows
    const firstGroup = groups[0]!;
    await user.click(firstGroup);
    expect(firstGroup).toHaveAttribute("aria-expanded", "true");
    const rows = screen.getAllByTestId("local-run-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("1/2");
    expect(rows[1]!.textContent).toContain("2/2");

    // toggle-all opens the remaining group, then closes everything
    const toggleAll = screen.getByTestId("local-runs-toggle-all");
    expect(toggleAll).toHaveTextContent("Expand all");
    await user.click(toggleAll);
    for (const g of screen.getAllByTestId("local-run-group")) {
      expect(g).toHaveAttribute("aria-expanded", "true");
    }
    expect(screen.getAllByTestId("local-run-row")).toHaveLength(3);
    expect(screen.getByTestId("local-runs-toggle-all")).toHaveTextContent("Collapse all");
    await user.click(screen.getByTestId("local-runs-toggle-all"));
    for (const g of screen.getAllByTestId("local-run-group")) {
      expect(g).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryAllByTestId("local-run-row")).toHaveLength(0);
  });

  it("shows the summed saved amount in the hero tile once pricing resolves", async () => {
    const a = agent({
      id: "a",
      metadata: JSON.stringify({ external: { run_id: "a", group: "digest-v2", stats } }),
    });
    const b = agent({
      id: "b",
      metadata: JSON.stringify({ external: { run_id: "b", group: "digest-v2", stats } }),
    });
    render(<LocalRunsPanel agents={[a, b]} comparisonModel="claude-opus-4" />);

    // 2 runs x (1M*3 + 1M*15) = 36.0
    const saved = await screen.findByTestId("local-runs-total-saved");
    expect(saved).toHaveTextContent("$36.00");
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("shows the session-cost context under the saved amount when sessionCost is positive", async () => {
    const a = agent({
      id: "a",
      metadata: JSON.stringify({ external: { run_id: "a", group: "digest-v2", stats } }),
    });
    render(<LocalRunsPanel agents={[a]} comparisonModel="claude-opus-4" sessionCost={100} />);

    // 1 run x (1M*3 + 1M*15) = 18.0
    const saved = await screen.findByTestId("local-runs-total-saved");
    expect(saved).toHaveTextContent("$18.00");
    const context = screen.getByTestId("local-runs-context");
    expect(context).toHaveTextContent("$100.00");
    expect(context).toHaveTextContent("$118.00");
    expect(context).toHaveTextContent("18%");
  });

  it("hides the session-cost context without sessionCost or when it is zero", async () => {
    const a = agent({
      id: "a",
      metadata: JSON.stringify({ external: { run_id: "a", group: "digest-v2", stats } }),
    });
    const { unmount } = render(<LocalRunsPanel agents={[a]} comparisonModel="claude-opus-4" />);
    await screen.findByTestId("local-runs-total-saved");
    expect(screen.queryByTestId("local-runs-context")).toBeNull();
    unmount();

    render(<LocalRunsPanel agents={[a]} comparisonModel="claude-opus-4" sessionCost={0} />);
    await screen.findByTestId("local-runs-total-saved");
    expect(screen.queryByTestId("local-runs-context")).toBeNull();
  });

  it("shows — and the no-price note when no rule matches", async () => {
    listMock.mockResolvedValue({ pricing: [pricing("gpt-%")] });
    const a = agent({
      metadata: JSON.stringify({
        external: {
          run_id: "a",
          stats: { input_tokens: 1000, output_tokens: 500 },
        },
      }),
    });
    render(<LocalRunsPanel agents={[a]} comparisonModel="claude-opus-4" />);
    expect(
      (await screen.findAllByText(/No price is set for Claude Opus 4/)).length
    ).toBeGreaterThan(0);
    expect(screen.getByTestId("local-runs-total-saved")).toHaveTextContent("—");
  });

  it("opens a group containing a running run without a click", () => {
    const a = agent({
      id: "a",
      status: "working",
      ended_at: null,
      metadata: JSON.stringify({
        external: { run_id: "a", group: "digest-v2", step: "1/2", stats },
      }),
    });
    render(<LocalRunsPanel agents={[a]} comparisonModel="claude-opus-4" />);
    const group = screen.getByTestId("local-run-group");
    expect(group).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByTestId("local-run-row")).toHaveLength(1);
  });
});

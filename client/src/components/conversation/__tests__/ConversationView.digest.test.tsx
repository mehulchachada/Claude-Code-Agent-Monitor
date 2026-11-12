/**
 * @file ConversationView.digest.test.tsx
 * @description Verifies how the Conversation tab hosts the digest view: it is
 * the default, the choice of view is remembered, the digest loads the whole
 * history on its own, and switching to the list restores the flat transcript.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ transcript: vi.fn() }));

vi.mock("../../../lib/api", () => ({
  api: {
    sessions: {
      transcripts: vi.fn().mockResolvedValue({ transcripts: [] }),
      transcript: mocks.transcript,
    },
  },
}));

vi.mock("../../../lib/eventBus", () => ({
  eventBus: { subscribe: vi.fn(() => () => {}), onConnection: vi.fn(() => () => {}) },
}));

import { ConversationView } from "../ConversationView";

const VIEW_MODE_KEY = "agent-dashboard-conversation-view";
const ts = "2026-08-01T12:00:00.000Z";

/** Two complete turns: the first uses a tool, the second answers directly. */
const TWO_TURNS = [
  {
    type: "user",
    sender: "user",
    timestamp: ts,
    content: [{ type: "text", text: "Fix the bug" }],
  },
  {
    type: "assistant",
    sender: "assistant",
    timestamp: ts,
    content: [
      { type: "thinking", text: "look first" },
      { type: "text", text: "Reading the file." },
      { type: "tool_use", id: "t1", name: "read_file", input: { path: "a.ts" } },
    ],
  },
  {
    type: "user",
    sender: "tool",
    timestamp: ts,
    content: [{ type: "tool_result", id: "t1", output: "ok" }],
  },
  {
    type: "user",
    sender: "user",
    timestamp: "2026-08-01T12:05:00.000Z",
    content: [{ type: "text", text: "Now ship it" }],
  },
  {
    type: "assistant",
    sender: "assistant",
    timestamp: ts,
    content: [{ type: "text", text: "Shipped." }],
  },
];

beforeEach(() => {
  localStorage.clear();
  mocks.transcript.mockReset();
  mocks.transcript.mockResolvedValue({
    messages: TWO_TURNS,
    total: 5,
    first_line: 1,
    last_line: 5,
    has_more: false,
  });
});

afterEach(() => {
  localStorage.clear();
});

describe("ConversationView digest", () => {
  it("opens in the digest view with the newest turn selected", async () => {
    render(<ConversationView sessionId="s1" />);

    const digest = await screen.findByTestId("turn-digest");
    expect(screen.getByTestId("view-mode-digest")).toHaveAttribute("aria-pressed", "true");

    const items = within(digest).getAllByTestId("turn-item");
    expect(items).toHaveLength(2);
    // Newest first.
    expect(items[0]).toHaveTextContent("Now ship it");
    expect(items[1]).toHaveTextContent("Fix the bug");

    const detail = within(digest).getByTestId("turn-detail");
    expect(within(detail).getByText("Now ship it")).toBeInTheDocument();
    expect(within(detail).getByText("Shipped.")).toBeInTheDocument();
  });

  it("keeps the outline in place while the detail follows the selection", async () => {
    render(<ConversationView sessionId="s1" />);
    const digest = await screen.findByTestId("turn-digest");

    const older = within(digest).getAllByTestId("turn-item")[1]!;
    fireEvent.click(older);

    const detail = within(digest).getByTestId("turn-detail");
    expect(within(detail).getByText("Fix the bug")).toBeInTheDocument();
    expect(within(detail).queryByText("Shipped.")).toBeNull();
    expect(within(digest).getAllByTestId("turn-item")).toHaveLength(2);
  });

  it("switches to the list view and remembers the choice", async () => {
    render(<ConversationView sessionId="s1" />);
    await screen.findByTestId("turn-digest");

    fireEvent.click(screen.getByTestId("view-mode-list"));

    expect(screen.queryByTestId("turn-digest")).toBeNull();
    expect(screen.getByText("Reading the file.")).toBeInTheDocument();
    expect(screen.getByText("Shipped.")).toBeInTheDocument();
    expect(localStorage.getItem(VIEW_MODE_KEY)).toBe("list");
  });

  it("opens in the list view when that was the stored choice", async () => {
    localStorage.setItem(VIEW_MODE_KEY, "list");
    render(<ConversationView sessionId="s1" />);

    await screen.findByText("Shipped.");
    expect(screen.queryByTestId("turn-digest")).toBeNull();
    expect(screen.getByTestId("view-mode-list")).toHaveAttribute("aria-pressed", "true");
  });

  it("loads the earlier history on its own so the outline lists every turn", async () => {
    mocks.transcript.mockReset();
    mocks.transcript
      .mockResolvedValueOnce({
        messages: TWO_TURNS.slice(3),
        total: 5,
        first_line: 4,
        last_line: 5,
        has_more: true,
      })
      .mockResolvedValue({
        messages: TWO_TURNS.slice(0, 3),
        total: 5,
        first_line: 1,
        last_line: 3,
        has_more: false,
      });

    render(<ConversationView sessionId="s1" />);
    const digest = await screen.findByTestId("turn-digest");

    await waitFor(() => {
      expect(within(digest).getAllByTestId("turn-item")).toHaveLength(2);
    });
    expect(mocks.transcript).toHaveBeenCalledWith("s1", expect.objectContaining({ before: 4 }));
    // The selection made before the history arrived is kept.
    expect(within(digest).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("does not load history on its own in the list view", async () => {
    localStorage.setItem(VIEW_MODE_KEY, "list");
    mocks.transcript.mockReset();
    mocks.transcript.mockResolvedValue({
      messages: TWO_TURNS.slice(3),
      total: 5,
      first_line: 4,
      last_line: 5,
      has_more: true,
    });

    render(<ConversationView sessionId="s1" />);
    await screen.findByText("Shipped.");

    expect(mocks.transcript).toHaveBeenCalledTimes(1);
  });
});

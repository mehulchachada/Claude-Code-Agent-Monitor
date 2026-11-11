/**
 * @file ConversationView.digest.test.tsx
 * @description Verifies the digest view: the toggle shows it, turns render
 * with prompt + reply previews and activity chips, and switching back to the
 * list view restores the flat message list.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

const ts = "2026-08-01T12:00:00.000Z";

beforeEach(() => {
  mocks.transcript.mockReset();
  mocks.transcript.mockResolvedValue({
    messages: [
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
        timestamp: ts,
        content: [{ type: "text", text: "Now ship it" }],
      },
      {
        type: "assistant",
        sender: "assistant",
        timestamp: ts,
        content: [{ type: "text", text: "Shipped." }],
      },
    ],
    total: 5,
    first_line: 1,
    last_line: 5,
    has_more: false,
  });
});

describe("ConversationView digest", () => {
  it("renders the digest toggle in the toolbar", async () => {
    render(<ConversationView sessionId="s1" />);
    await screen.findByText("Fix the bug");
    expect(screen.getByTestId("view-mode-digest")).toBeTruthy();
  });

  it("switches to the digest view and shows turn previews", async () => {
    render(<ConversationView sessionId="s1" />);
    await screen.findByText("Fix the bug");

    fireEvent.click(screen.getByTestId("view-mode-digest"));

    expect(screen.getByText("Fix the bug")).toBeTruthy();
    expect(screen.getByText("Now ship it")).toBeTruthy();
    expect(screen.getByText("Reading the file.")).toBeTruthy();
    expect(screen.getByText("Shipped.")).toBeTruthy();
    expect(screen.getByText(/1 tool/)).toBeTruthy();
    expect(screen.getByText(/1 thinking/)).toBeTruthy();
    expect(screen.getByText(/2 turns/)).toBeTruthy();
  });

  it("searches turns and shows a no-match state", async () => {
    render(<ConversationView sessionId="s1" />);
    await screen.findByText("Fix the bug");

    fireEvent.click(screen.getByTestId("view-mode-digest"));
    expect(screen.getByText(/2 turns/)).toBeTruthy();

    const search = screen.getByTestId("digest-search");
    fireEvent.change(search, { target: { value: "ship" } });
    // Only the "Now ship it" turn matches.
    expect(screen.getByText("Now ship it")).toBeTruthy();
    expect(screen.queryByText("Fix the bug")).toBeNull();
    expect(screen.getByText(/1 turn/)).toBeTruthy();

    fireEvent.change(search, { target: { value: "zzz-no-such-text" } });
    expect(screen.queryByText("Now ship it")).toBeNull();
    expect(screen.getByText(/0 turns/)).toBeTruthy();
  });

  it("switches back to the list view", async () => {
    render(<ConversationView sessionId="s1" />);
    await screen.findByText("Fix the bug");

    fireEvent.click(screen.getByTestId("view-mode-digest"));
    expect(screen.getByText(/2 turns/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("view-mode-list"));
    expect(screen.queryByText(/2 turns/)).toBeNull();
  });
});

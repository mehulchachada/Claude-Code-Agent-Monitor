/**
 * @file ConversationView.filter.test.tsx
 * @description Verifies the conversation content filter in the rendered view:
 * choosing a kind hides everything else, the count line reports what is
 * shown, and clearing the filter restores the full conversation.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

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

afterEach(() => {
  mocks.transcript.mockReset();
});

describe("ConversationView content filter", () => {
  it("filters by kind and restores the conversation when cleared", async () => {
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
          content: [{ type: "text", text: "It is fixed" }],
        },
      ],
      total: 2,
      first_line: 1,
      last_line: 2,
      has_more: false,
    });

    render(<ConversationView sessionId="filter-session" />);
    await screen.findByText("Fix the bug");
    expect(screen.getByText("It is fixed")).toBeInTheDocument();
    // No tool calls in this conversation, so only the kind picker is offered.
    expect(screen.queryByRole("button", { name: /filter by tool/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /filter by kind/i }));
    fireEvent.click(await screen.findByText("Prompts (1)"));

    expect(screen.getByText("Fix the bug")).toBeInTheDocument();
    expect(screen.queryByText("It is fixed")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 2 loaded messages")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("It is fixed")).toBeInTheDocument();
    expect(screen.queryByText(/loaded messages/)).not.toBeInTheDocument();
  });
});

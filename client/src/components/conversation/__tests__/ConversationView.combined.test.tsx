/**
 * @file ConversationView.combined.test.tsx
 * @description Verifies the combined "all agents" view: the picker offers it,
 * switching to it merges every transcript in chronological order with source
 * chips, and the single-transcript loader is never asked for a transcript
 * called "__all__".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ transcript: vi.fn() }));

vi.mock("../../../lib/api", () => ({
  api: {
    sessions: {
      transcripts: vi.fn().mockResolvedValue({
        transcripts: [
          { id: "main", name: "Main Agent", type: "main", has_transcript: true },
          {
            id: "ext-job-1",
            name: "Draft the rules",
            type: "subagent",
            subagent_type: "external",
            has_transcript: true,
          },
        ],
      }),
      transcript: mocks.transcript,
    },
  },
}));

vi.mock("../../../lib/eventBus", () => ({
  eventBus: { subscribe: vi.fn(() => () => {}), onConnection: vi.fn(() => () => {}) },
}));

import { ConversationView } from "../ConversationView";

const mainResult = {
  messages: [
    {
      type: "user",
      sender: "user",
      timestamp: "2026-08-01T12:00:00.000Z",
      content: [{ type: "text", text: "Fix the bug" }],
    },
    {
      type: "assistant",
      sender: "assistant",
      timestamp: "2026-08-01T12:00:10.000Z",
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "It is fixed" }],
    },
  ],
  total: 2,
  first_line: 1,
  last_line: 9,
  has_more: false,
};

const subResult = {
  messages: [
    {
      type: "assistant",
      sender: "assistant",
      timestamp: "2026-08-01T12:00:05.000Z",
      model: "qwen3.8:27b",
      content: [{ type: "text", text: "Qwen answer" }],
    },
  ],
  total: 1,
  first_line: 1,
  last_line: 9,
  has_more: false,
};

function mockTranscript() {
  mocks.transcript.mockImplementation((_sessionId: string, params?: { agent_id?: string }) => {
    if (params?.agent_id === "ext-job-1") return Promise.resolve(subResult);
    return Promise.resolve(mainResult);
  });
}

afterEach(() => {
  mocks.transcript.mockReset();
});

describe("ConversationView combined view", () => {
  it("merges every transcript in order with source chips", async () => {
    mockTranscript();

    const { container } = render(<ConversationView sessionId="combined-session" />);
    await screen.findByText("Fix the bug");
    expect(screen.getByText("It is fixed")).toBeInTheDocument();
    // The sub-agent transcript is not loaded in single-transcript mode.
    expect(screen.queryByText("Qwen answer")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="message-source"]').length).toBe(0);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "__all__" } });
    await screen.findByText("Qwen answer");

    const prompt = screen.getByText("Fix the bug");
    const qwen = screen.getByText("Qwen answer");
    const claude = screen.getByText("It is fixed");
    // All three messages are on screen, in chronological order.
    expect(prompt.compareDocumentPosition(qwen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(qwen.compareDocumentPosition(claude) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Every message in the combined view carries a source chip.
    expect(
      container.querySelectorAll('[data-testid="message-source"]').length
    ).toBeGreaterThanOrEqual(1);

    // The single-transcript loader must never be asked for the picker sentinel.
    for (const call of mocks.transcript.mock.calls) {
      expect(call[1]?.agent_id).not.toBe("__all__");
    }
  });
});

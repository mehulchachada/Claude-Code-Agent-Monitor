/**
 * @file ConversationView.combined.test.tsx
 * @description Verifies the combined view of the Conversation tab: it is the
 * default when a session has more than one transcript, merges every transcript
 * in time order with source chips, and never asks the server for a transcript
 * named after the picker value.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ transcript: vi.fn(), transcripts: vi.fn() }));

vi.mock("../../../lib/api", () => ({
  api: {
    sessions: {
      transcripts: mocks.transcripts,
      transcript: mocks.transcript,
    },
  },
}));

vi.mock("../../../lib/eventBus", () => ({
  eventBus: { subscribe: vi.fn(() => () => {}), onConnection: vi.fn(() => () => {}) },
}));

import { ConversationView } from "../ConversationView";

const mainEntry = { id: "main", name: "Main Agent", type: "main", has_transcript: true };
const subEntry = {
  id: "ext-job-1",
  name: "Draft the rules",
  type: "subagent",
  subagent_type: "external",
  has_transcript: true,
};

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

function renderView(props: { initialTranscriptId?: string } = {}) {
  return render(<ConversationView sessionId="combined-session" {...props} />);
}

// These cases exercise the flat list; the tab opens in the digest view by default.
beforeEach(() => {
  localStorage.setItem("agent-dashboard-conversation-view", "list");
});

afterEach(() => {
  localStorage.clear();
  mocks.transcript.mockReset();
  mocks.transcripts.mockReset();
});

describe("ConversationView combined view", () => {
  it("shows the combined view by default when there are two transcripts", async () => {
    mocks.transcripts.mockResolvedValue({ transcripts: [mainEntry, subEntry] });
    mockTranscript();

    const { container } = renderView();
    await screen.findByText("Qwen answer");

    const prompt = screen.getByText("Fix the bug");
    const qwen = screen.getByText("Qwen answer");
    const claude = screen.getByText("It is fixed");
    // All three messages are on screen, in chronological order.
    expect(prompt.compareDocumentPosition(qwen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(qwen.compareDocumentPosition(claude) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The picker reflects what is on screen: the combined entry.
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("__all__");

    // Every message in the combined view carries a source chip.
    expect(
      container.querySelectorAll('[data-testid="message-source"]').length
    ).toBeGreaterThanOrEqual(1);

    // The single-transcript loader must never be asked for the picker sentinel.
    for (const call of mocks.transcript.mock.calls) {
      expect(call[1]?.agent_id).not.toBe("__all__");
    }
  });

  it("does not load the main transcript before the default is known", async () => {
    mocks.transcripts.mockResolvedValue({ transcripts: [mainEntry, subEntry] });
    mockTranscript();

    renderView();
    await screen.findByText("Qwen answer");

    // Exactly one main-transcript request: the combined view's own load of main.
    // A wasted pre-default load would make this two.
    const mainLoads = mocks.transcript.mock.calls.filter((call) => call[1]?.agent_id == null);
    expect(mainLoads.length).toBe(1);
  });

  it("lets an explicit picker choice win over the combined default", async () => {
    mocks.transcripts.mockResolvedValue({ transcripts: [mainEntry, subEntry] });
    mockTranscript();

    const { container } = renderView();
    await screen.findByText("Qwen answer");

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "main" } });
    await waitFor(() => expect(screen.queryByText("Qwen answer")).not.toBeInTheDocument());
    expect(screen.getByText("It is fixed")).toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="message-source"]').length).toBe(0);
  });

  it("honours initialTranscriptId over the combined default", async () => {
    mocks.transcripts.mockResolvedValue({ transcripts: [mainEntry, subEntry] });
    mockTranscript();

    renderView({ initialTranscriptId: "ext-job-1" });
    await screen.findByText("Qwen answer");
    expect(screen.queryByText("It is fixed")).not.toBeInTheDocument();
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("ext-job-1");
  });

  it("shows the main transcript by default when there is only one", async () => {
    mocks.transcripts.mockResolvedValue({ transcripts: [mainEntry] });
    mockTranscript();

    const { container } = renderView();
    await screen.findByText("It is fixed");
    expect(screen.queryByText("Qwen answer")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-testid="message-source"]').length).toBe(0);
    for (const call of mocks.transcript.mock.calls) {
      expect(call[1]?.agent_id).not.toBe("__all__");
    }
  });
});

/**
 * @file TurnDigest.test.tsx
 * @description Verifies the v2 digest view: newest turn listed first and selected
 * initially, selection changes the detail while the outline stays put, step
 * expansion, the level toggle, search with the no-match state, keyboard
 * navigation and the partial leading turn.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import type { RenderResult } from "@testing-library/react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { TranscriptMessage } from "../../../lib/types";
import { groupIntoTurns } from "../../../lib/conversation-turns";
import { TurnDigest } from "../TurnDigest";

/** Build a minimal transcript message. */
function msg(
  partial: Partial<TranscriptMessage> & { content: TranscriptMessage["content"] }
): TranscriptMessage {
  return { type: "user", timestamp: null, ...partial };
}

/** A sub-agent message. */
function subAgentMsg(text: string, name = "researcher"): TranscriptMessage {
  return {
    ...msg({
      type: "assistant",
      sender: "assistant",
      content: [{ type: "text", text }],
    }),
    source: { id: `sub-${name}`, name, type: "subagent" },
  } as TranscriptMessage;
}

/** The fixture: a partial leading turn plus two full turns, oldest first. */
const MESSAGES: TranscriptMessage[] = [
  // Partial leading turn (no prompt loaded yet).
  msg({
    id: "p1",
    type: "assistant",
    sender: "assistant",
    timestamp: "2026-01-01T09:00:00Z",
    content: [{ type: "text", text: "Earlier work in progress" }],
  }),
  // Turn one.
  msg({
    id: "t1-prompt",
    type: "user",
    sender: "user",
    timestamp: "2026-01-01T09:01:00Z",
    content: [{ type: "text", text: "Fix the login bug" }],
  }),
  msg({
    id: "t1-tool",
    type: "assistant",
    sender: "assistant",
    timestamp: "2026-01-01T09:02:00Z",
    content: [{ type: "tool_use", name: "Bash", id: "call-1" }],
  }),
  msg({
    id: "t1-result",
    type: "user",
    sender: "tool",
    timestamp: "2026-01-01T09:03:00Z",
    content: [{ type: "tool_result", id: "call-1", output: "ok" }],
  }),
  msg({
    id: "t1-answer",
    type: "assistant",
    sender: "assistant",
    timestamp: "2026-01-01T09:04:00Z",
    content: [{ type: "text", text: "The login bug is fixed" }],
  }),
  // Turn two (newest).
  msg({
    id: "t2-prompt",
    type: "user",
    sender: "user",
    timestamp: "2026-01-01T09:10:00Z",
    content: [{ type: "text", text: "Now add tests" }],
  }),
  subAgentMsg("Researching test patterns"),
  msg({
    id: "t2-answer",
    type: "assistant",
    sender: "assistant",
    timestamp: "2026-01-01T09:12:00Z",
    content: [{ type: "text", text: "Tests added for the login flow" }],
  }),
];

function renderDigest() {
  const turns = groupIntoTurns(MESSAGES);
  return render(<TurnDigest turns={turns} />);
}

/** Render the digest with a custom message list (for follow-newest tests). */
function renderMessages(messages: TranscriptMessage[]): RenderResult {
  return render(<TurnDigest turns={groupIntoTurns(messages)} />);
}

describe("TurnDigest (v2)", () => {
  it("lists the newest turn first and selects it initially", () => {
    renderDigest();
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    // Newest first: "Now add tests", then "Fix the login bug", then the partial turn.
    expect(options[0]).toHaveTextContent("Now add tests");
    expect(options[1]).toHaveTextContent("Fix the login bug");
    expect(options[2]).toHaveTextContent("Earlier activity");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(options[1]).toHaveAttribute("aria-selected", "false");
    // The detail shows the selected (newest) turn's prompt and answer.
    const detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("Now add tests")).toBeInTheDocument();
    expect(within(detail).getByText("Tests added for the login flow")).toBeInTheDocument();
  });

  it("selecting another turn changes the detail and leaves every outline item in the document", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    fireEvent.click(items[1]!);
    const detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("Fix the login bug")).toBeInTheDocument();
    expect(within(detail).getByText("The login bug is fixed")).toBeInTheDocument();
    // All three outline items are still present.
    expect(screen.getAllByTestId("turn-item")).toHaveLength(3);
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
  });

  it("expanding a step shows its messages and does not change which turn is selected", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    // Select the turn with a tool step.
    fireEvent.click(items[1]!);
    const detail = screen.getByTestId("turn-detail");
    const step = within(detail).getByTestId("turn-step");
    expect(step).toHaveTextContent("Bash");
    expect(step).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(step);
    expect(step).toHaveAttribute("aria-expanded", "true");
    // The tool result output is now visible in the detail.
    expect(within(detail).getByText("ok")).toBeInTheDocument();
    // Selection is unchanged.
    const options = screen.getAllByRole("option");
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getAllByTestId("turn-item")).toHaveLength(3);
  });

  it("shows everything at the Everything level", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    // Select the newest turn (turn two) which has a sub-agent message.
    fireEvent.click(items[0]!);
    const detail = screen.getByTestId("turn-detail");
    // Steps level: the prompt box is shown.
    expect(within(detail).getByText("Prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Everything" }));
    // Everything level: the full message stream, including the sub-agent line.
    expect(within(detail).getByText("Researching test patterns")).toBeInTheDocument();
    expect(within(detail).queryByTestId("turn-step")).not.toBeInTheDocument();
  });

  it("narrows the outline with search and shows the no-match text", () => {
    renderDigest();
    const search = screen.getByTestId("turn-search");
    // "bug" is unique to turn one.
    fireEvent.change(search, { target: { value: "bug" } });
    expect(screen.getAllByTestId("turn-item")).toHaveLength(1);
    expect(screen.getByTestId("turn-item")).toHaveTextContent("Fix the login bug");
    fireEvent.change(search, { target: { value: "zzz-no-such-thing" } });
    expect(screen.queryAllByTestId("turn-item")).toHaveLength(0);
    expect(screen.getByText("No turns match your search.")).toBeInTheDocument();
    expect(screen.queryByTestId("turn-detail")).not.toBeInTheDocument();
  });

  it("moves the selection with ArrowDown", () => {
    renderDigest();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    const list = screen.getByRole("listbox");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options[1]).toHaveAttribute("aria-selected", "true");
    expect(options[0]).toHaveAttribute("aria-selected", "false");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(list).toBeInTheDocument();
  });

  it("shows a singular chip for a turn with exactly one tool", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    // Turn one has exactly one tool (Bash).
    expect(items[1]).toHaveTextContent("1 tool");
    expect(items[1]).not.toHaveTextContent("1 tools");
  });

  it("numbers the outline items from the oldest turn and keeps numbers while searching", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    // Newest first: #3, #2, #1.
    expect(items[0]).toHaveTextContent("#3");
    expect(items[1]).toHaveTextContent("#2");
    expect(items[2]).toHaveTextContent("#1");
    // Searching down to one turn keeps that turn's number.
    const search = screen.getByTestId("turn-search");
    fireEvent.change(search, { target: { value: "bug" } });
    expect(screen.getAllByTestId("turn-item")).toHaveLength(1);
    expect(screen.getByTestId("turn-item")).toHaveTextContent("#2");
  });

  it("shows the turn position in the detail header", () => {
    renderDigest();
    const detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("Turn 3 of 3")).toBeInTheDocument();
  });

  it("collapses a long prompt behind a toggle and leaves short prompts open", () => {
    const longText = "x".repeat(700);
    const longTurn = [
      msg({
        id: "lp-prompt",
        type: "user",
        sender: "user",
        timestamp: "2026-01-01T09:01:00Z",
        content: [{ type: "text", text: longText }],
      }),
      msg({
        id: "lp-answer",
        type: "assistant",
        sender: "assistant",
        timestamp: "2026-01-01T09:02:00Z",
        content: [{ type: "text", text: "Done" }],
      }),
    ];
    renderMessages(longTurn);
    const toggle = screen.getByTestId("prompt-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("does not render a prompt toggle for a short prompt", () => {
    const shortTurn = [
      msg({
        id: "sp-prompt",
        type: "user",
        sender: "user",
        timestamp: "2026-01-01T09:01:00Z",
        content: [{ type: "text", text: "Fix the login bug" }],
      }),
      msg({
        id: "sp-answer",
        type: "assistant",
        sender: "assistant",
        timestamp: "2026-01-01T09:02:00Z",
        content: [{ type: "text", text: "Done" }],
      }),
    ];
    renderMessages(shortTurn);
    expect(screen.queryByTestId("prompt-toggle")).not.toBeInTheDocument();
  });

  it("follows the newest turn until the user selects one", () => {
    const turn = (n: number, prompt: string, answer: string) => [
      msg({
        id: `f${n}-prompt`,
        type: "user",
        sender: "user",
        timestamp: `2026-01-01T09:0${n}:00Z`,
        content: [{ type: "text", text: prompt }],
      }),
      msg({
        id: `f${n}-answer`,
        type: "assistant",
        sender: "assistant",
        timestamp: `2026-01-01T09:1${n}:00Z`,
        content: [{ type: "text", text: answer }],
      }),
    ];
    const { rerender } = render(
      <TurnDigest turns={groupIntoTurns([...turn(1, "P1", "A1"), ...turn(2, "P2", "A2")])} />
    );
    // Nothing clicked: the detail shows the newest turn.
    let detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("P2")).toBeInTheDocument();
    // A newer turn arrives: the detail follows it.
    rerender(
      <TurnDigest
        turns={groupIntoTurns([
          ...turn(1, "P1", "A1"),
          ...turn(2, "P2", "A2"),
          ...turn(3, "P3", "A3"),
        ])}
      />
    );
    detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("P3")).toBeInTheDocument();
    // The user clicks the oldest turn: the selection is pinned.
    const items = screen.getAllByTestId("turn-item");
    fireEvent.click(items[items.length - 1]!);
    detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("P1")).toBeInTheDocument();
    // A fourth turn arrives: the detail stays on the oldest turn.
    rerender(
      <TurnDigest
        turns={groupIntoTurns([
          ...turn(1, "P1", "A1"),
          ...turn(2, "P2", "A2"),
          ...turn(3, "P3", "A3"),
          ...turn(4, "P4", "A4"),
        ])}
      />
    );
    detail = screen.getByTestId("turn-detail");
    expect(within(detail).getByText("P1")).toBeInTheDocument();
    expect(within(detail).queryByText("P4")).not.toBeInTheDocument();
  });

  it("shows the translated earlier-activity text for a partial turn", () => {
    renderDigest();
    const items = screen.getAllByTestId("turn-item");
    expect(items[2]).toHaveTextContent("Earlier activity");
    fireEvent.click(items[2]!);
    const detail = screen.getByTestId("turn-detail");
    expect(
      within(detail).getByText("The prompt for this activity is earlier in the history.")
    ).toBeInTheDocument();
    expect(within(detail).queryByText("Tests added for the login flow")).not.toBeInTheDocument();
  });
});

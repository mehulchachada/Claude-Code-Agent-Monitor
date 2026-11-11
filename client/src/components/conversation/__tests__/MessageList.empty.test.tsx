/**
 * @file MessageList.empty.test.tsx
 * @description Verifies that a mounted MessageList can be re-rendered with no
 * messages (and back) without changing its hook count, which React treats as a
 * fatal error that blanks the page.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MessageList } from "../MessageList";
import type { TranscriptMessage } from "../../../lib/types";

const messages: TranscriptMessage[] = [
  {
    type: "user",
    sender: "user",
    timestamp: "2026-08-01T12:00:00.000Z",
    content: [{ type: "text", text: "Fix the bug" }],
  },
];

describe("MessageList with a list that empties", () => {
  it("re-renders from messages to none and back", () => {
    const { rerender } = render(<MessageList messages={messages} loading={false} />);
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();

    rerender(<MessageList messages={[]} loading={false} />);
    expect(screen.getByText("No conversation records found.")).toBeInTheDocument();

    rerender(<MessageList messages={messages} loading={false} />);
    expect(screen.getByText("Fix the bug")).toBeInTheDocument();

    rerender(<MessageList messages={messages} loading />);
    expect(screen.getByText("Loading conversation...")).toBeInTheDocument();
  });
});

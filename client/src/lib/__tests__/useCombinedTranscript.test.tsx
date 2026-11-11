/**
 * @file useCombinedTranscript.test.tsx
 * @description Tests for the useCombinedTranscript hook: initial load of
 * several transcripts, merging with source tags, refresh and loadOlder
 * paging, live WebSocket updates and failure handling.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { TranscriptInfo, TranscriptMessage, TranscriptResult } from "../types";

const mocks = vi.hoisted(() => ({
  transcript: vi.fn(),
  subscribe: vi.fn<(handler: (msg: unknown) => void) => () => void>(() => () => {}),
  onConnection: vi.fn<(handler: (connected: boolean) => void) => () => void>(() => () => {}),
}));

vi.mock("../api", () => ({
  api: { sessions: { transcript: mocks.transcript } },
}));

vi.mock("../eventBus", () => ({
  eventBus: { subscribe: mocks.subscribe, onConnection: mocks.onConnection },
}));

import { useCombinedTranscript } from "../useCombinedTranscript";

const main: TranscriptInfo = { id: "main", name: "Main", type: "main", has_transcript: true };
const sub: TranscriptInfo = {
  id: "sub-1",
  name: "Sub",
  type: "subagent",
  subagent_type: "task",
  has_transcript: true,
};

function msg(id: string, text: string, timestamp: string): TranscriptMessage {
  return { id, type: "user", sender: "user", timestamp, content: [{ type: "text", text }] };
}

function result(
  messages: TranscriptMessage[],
  firstLine: number,
  lastLine: number,
  hasMore = false
): TranscriptResult {
  return {
    messages,
    total: messages.length,
    first_line: firstLine,
    last_line: lastLine,
    has_more: hasMore,
  };
}

afterEach(() => {
  mocks.transcript.mockReset();
  mocks.subscribe.mockClear();
  mocks.onConnection.mockClear();
});

describe("useCombinedTranscript", () => {
  it("makes no request and returns an empty result when disabled", async () => {
    mocks.transcript.mockResolvedValue(result([], 0, 0));
    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main], false));
    await act(async () => {});
    expect(hook.current.messages).toEqual([]);
    expect(hook.current.loading).toBe(false);
    expect(hook.current.error).toBeNull();
    expect(hook.current.hasMore).toBe(false);
    expect(hook.current.heldBack).toBe(0);
    expect(hook.current.loadingOlder).toBe(false);
    expect(mocks.transcript).not.toHaveBeenCalled();
  });

  it("merges two transcripts in time order, tagged with their source", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { agent_id?: string }) => {
      if (params?.agent_id === "sub-1") {
        return Promise.resolve(
          result([msg("m2", "sub says hi", "2026-08-01T10:01:00.000Z")], 1, 1)
        );
      }
      return Promise.resolve(
        result(
          [
            msg("m1", "main first", "2026-08-01T10:00:00.000Z"),
            msg("m3", "main last", "2026-08-01T10:02:00.000Z"),
          ],
          1,
          2
        )
      );
    });

    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main, sub], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect(hook.current.messages[0]?.source.id).toBe("main");
    expect(hook.current.messages[1]?.source.id).toBe("sub-1");
    expect(hook.current.messages[2]?.source.id).toBe("main");

    expect(mocks.transcript).toHaveBeenCalledTimes(2);
    expect(mocks.transcript).toHaveBeenCalledWith("s1", { limit: 50 });
    expect(mocks.transcript).toHaveBeenCalledWith("s1", { limit: 50, agent_id: "sub-1" });
  });

  it("refresh() asks with after: lastLine and folds in the new message", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { after?: number }) => {
      if (params?.after === 2) {
        return Promise.resolve(result([msg("m4", "newer", "2026-08-01T10:03:00.000Z")], 3, 3));
      }
      return Promise.resolve(
        result(
          [
            msg("m1", "first", "2026-08-01T10:00:00.000Z"),
            msg("m2", "second", "2026-08-01T10:01:00.000Z"),
          ],
          1,
          2
        )
      );
    });

    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]);

    await act(async () => {
      await hook.current.refresh();
    });

    expect(mocks.transcript).toHaveBeenCalledWith("s1", { limit: 50, after: 2 });
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m4"]);
  });

  it("loadOlder() asks with before: firstLine for the watermark window", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { before?: number }) => {
      if (params?.before === 1) {
        return Promise.resolve(result([msg("m0", "older", "2026-08-01T09:59:00.000Z")], 0, 0));
      }
      return Promise.resolve(
        result(
          [
            msg("m1", "first", "2026-08-01T10:00:00.000Z"),
            msg("m2", "second", "2026-08-01T10:01:00.000Z"),
          ],
          1,
          2,
          true
        )
      );
    });

    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.hasMore).toBe(true);

    await act(async () => {
      await hook.current.loadOlder();
    });

    expect(mocks.transcript).toHaveBeenCalledWith("s1", { limit: 50, before: 1 });
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m0", "m1", "m2"]);
    expect(hook.current.hasMore).toBe(false);
  });

  it("refreshes on a WebSocket message for this session, not for another", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { after?: number }) => {
      if (params?.after === 1) {
        return Promise.resolve(result([msg("m2", "live", "2026-08-01T10:01:00.000Z")], 2, 2));
      }
      return Promise.resolve(result([msg("m1", "first", "2026-08-01T10:00:00.000Z")], 1, 1));
    });

    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1"]);

    const handler = mocks.subscribe.mock.calls[0]?.[0] as (msg: unknown) => void;
    await act(async () => {
      handler({ type: "new_event", data: { session_id: "other" } });
    });
    expect(mocks.transcript).toHaveBeenCalledTimes(1);

    await act(async () => {
      handler({ type: "new_event", data: { session_id: "s1" } });
    });
    await waitFor(() => expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]));
    expect(mocks.transcript).toHaveBeenCalledTimes(2);
  });

  it("shows the other transcript when one fails, with error null", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { agent_id?: string }) => {
      if (params?.agent_id === "sub-1") {
        return Promise.reject(new Error("boom"));
      }
      return Promise.resolve(result([msg("m1", "main only", "2026-08-01T10:00:00.000Z")], 1, 1));
    });

    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main, sub], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.error).toBeNull();
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("loads a transcript that appears later without re-requesting loaded ones", async () => {
    mocks.transcript.mockImplementation((_id: string, params?: { agent_id?: string }) => {
      if (params?.agent_id === "sub-1") {
        return Promise.resolve(result([msg("m2", "sub", "2026-08-01T10:01:00.000Z")], 1, 1));
      }
      return Promise.resolve(result([msg("m1", "main", "2026-08-01T10:00:00.000Z")], 1, 1));
    });

    const { result: hook, rerender } = renderHook(
      ({ list }: { list: TranscriptInfo[] }) => useCombinedTranscript("s1", list, true),
      { initialProps: { list: [main] } }
    );
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(mocks.transcript).toHaveBeenCalledTimes(1);

    rerender({ list: [main, sub] });
    await waitFor(() => expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]));

    // Exactly one request per transcript: main once, sub once.
    expect(mocks.transcript).toHaveBeenCalledTimes(2);
    expect(
      mocks.transcript.mock.calls.filter((call) => call[1]?.agent_id === undefined).length
    ).toBe(1);
  });

  it("keeps messages a refresh added while an older page was still loading", async () => {
    let releaseOlder: (value: TranscriptResult) => void = () => {};
    mocks.transcript.mockImplementation(
      (_id: string, params?: { after?: number; before?: number }) => {
        if (params?.before !== undefined) {
          return new Promise<TranscriptResult>((resolve) => {
            releaseOlder = resolve;
          });
        }
        if (params?.after !== undefined) {
          return Promise.resolve(result([msg("m3", "newer", "2026-08-01T10:03:00.000Z")], 3, 3));
        }
        return Promise.resolve(
          result([msg("m2", "loaded", "2026-08-01T10:02:00.000Z")], 2, 2, true)
        );
      }
    );
    const { result: hook } = renderHook(() => useCombinedTranscript("s1", [main], true));
    await waitFor(() => expect(hook.current.loading).toBe(false));

    let older: Promise<void> = Promise.resolve();
    act(() => {
      older = hook.current.loadOlder();
    });
    await act(async () => {
      await hook.current.refresh();
    });
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m2", "m3"]);

    await act(async () => {
      releaseOlder(result([msg("m1", "older", "2026-08-01T10:01:00.000Z")], 1, 1, false));
      await older;
    });
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("still loads a late transcript when the list is refreshed while it is loading", async () => {
    let releaseSub: (value: TranscriptResult) => void = () => {};
    mocks.transcript.mockImplementation((_id: string, params?: { agent_id?: string }) => {
      if (params?.agent_id === "sub-1") {
        return new Promise<TranscriptResult>((resolve) => {
          releaseSub = resolve;
        });
      }
      return Promise.resolve(result([msg("m1", "main", "2026-08-01T10:00:00.000Z")], 1, 1));
    });
    const { result: hook, rerender } = renderHook(
      ({ list }: { list: TranscriptInfo[] }) => useCombinedTranscript("s1", list, true),
      { initialProps: { list: [main] } }
    );
    await waitFor(() => expect(hook.current.loading).toBe(false));

    rerender({ list: [main, sub] }); // the sub-agent appears: its page starts loading
    rerender({ list: [{ ...main }, { ...sub }] }); // the caller polls the list again meanwhile
    await act(async () => {
      releaseSub(result([msg("m2", "sub", "2026-08-01T10:01:00.000Z")], 1, 1));
    });
    await waitFor(() => expect(hook.current.messages.map((m) => m.id)).toEqual(["m1", "m2"]));
    // Loaded once: the refreshed list did not start a second request for it.
    const subCalls = mocks.transcript.mock.calls.filter(
      (call) => (call[1] as { agent_id?: string } | undefined)?.agent_id === "sub-1"
    );
    expect(subCalls).toHaveLength(1);
  });

  it("reports loading while the first transcripts arrive after the hook was enabled", async () => {
    mocks.transcript.mockResolvedValue(
      result([msg("m1", "main", "2026-08-01T10:00:00.000Z")], 1, 1)
    );
    const { result: hook, rerender } = renderHook(
      ({ list }: { list: TranscriptInfo[] }) => useCombinedTranscript("s1", list, true),
      { initialProps: { list: [] as TranscriptInfo[] } }
    );
    await act(async () => {});
    expect(hook.current.messages).toEqual([]);

    rerender({ list: [main] });
    expect(hook.current.loading).toBe(true);
    await waitFor(() => expect(hook.current.loading).toBe(false));
    expect(hook.current.messages.map((m) => m.id)).toEqual(["m1"]);
  });
});

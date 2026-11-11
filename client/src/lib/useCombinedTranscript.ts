/**
 * @file useCombinedTranscript.ts
 * @description React hook that loads every transcript of a session (main agent
 * plus sub-agents), merges them into one time-ordered conversation, and keeps
 * it live via WebSocket events, connection recovery and a 3 second poll.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";
import { eventBus } from "./eventBus";
import {
  appendMessages,
  mergeTranscripts,
  prependMessages,
  sourceOf,
  type SourcedMessage,
  type TranscriptWindow,
} from "./conversation-merge";
import type { TranscriptInfo, WSMessage } from "./types";

export interface CombinedTranscript {
  /** Merged, visible messages, oldest first. */
  messages: SourcedMessage[];
  /** True until the first load of the current session finishes. */
  loading: boolean;
  /** Set only when every transcript failed to load. */
  error: string | null;
  /** True when older messages can still be loaded. */
  hasMore: boolean;
  /** Loaded messages currently held back by the watermark. */
  heldBack: number;
  loadingOlder: boolean;
  /** Load one older page of the transcript that currently limits the view. */
  loadOlder: () => Promise<void>;
  /** Fetch messages newer than what is loaded, for every transcript. */
  refresh: () => Promise<void>;
}

const PAGE_SIZE = 50;

interface TranscriptQuery {
  limit: number;
  agent_id?: string;
  after?: number;
  before?: number;
}

/** The transcripts of a session that actually have a file to read. */
function eligibleTranscripts(transcripts: TranscriptInfo[]): TranscriptInfo[] {
  return transcripts.filter((info) => info.has_transcript && info.type !== "compaction");
}

/** Build the query for one transcript; the main transcript is read without agent_id. */
function transcriptParams(
  source: { id: string; type: TranscriptInfo["type"] },
  cursor: { after?: number; before?: number }
): TranscriptQuery {
  const params: TranscriptQuery = { limit: PAGE_SIZE };
  if (source.type !== "main") params.agent_id = source.id;
  if (cursor.after !== undefined) params.after = cursor.after;
  if (cursor.before !== undefined) params.before = cursor.before;
  return params;
}

function windowFromResult(
  info: TranscriptInfo,
  result: {
    messages: TranscriptWindow["messages"];
    first_line: number;
    last_line: number;
    has_more: boolean;
  }
): TranscriptWindow {
  return {
    source: sourceOf(info),
    messages: result.messages,
    firstLine: result.first_line,
    lastLine: result.last_line,
    hasMore: result.has_more,
  };
}

export function useCombinedTranscript(
  sessionId: string,
  transcripts: TranscriptInfo[],
  enabled: boolean
): CombinedTranscript {
  const [windows, setWindows] = useState<TranscriptWindow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const windowsRef = useRef<TranscriptWindow[]>([]);
  const loadedIdsRef = useRef<Set<string>>(new Set());
  const pendingIdsRef = useRef<Set<string>>(new Set());
  const refreshChainRef = useRef<Promise<void> | null>(null);
  const refreshQueuedRef = useRef(false);
  const olderInFlightRef = useRef(false);
  const aliveRef = useRef(true);
  const sessionIdRef = useRef(sessionId);
  const enabledRef = useRef(enabled);
  const transcriptsRef = useRef(transcripts);
  transcriptsRef.current = transcripts;

  // Kept current during render (not in an effect) so a loadOlder() or refresh()
  // issued right after a state commit reads the windows that are on screen.
  windowsRef.current = windows;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // Reset everything and load the newest page of every eligible transcript.
  useEffect(() => {
    sessionIdRef.current = sessionId;
    enabledRef.current = enabled;
    loadedIdsRef.current = new Set();
    pendingIdsRef.current = new Set();
    refreshChainRef.current = null;
    refreshQueuedRef.current = false;
    olderInFlightRef.current = false;
    if (!enabled) {
      setWindows([]);
      setLoading(false);
      setError(null);
      setLoadingOlder(false);
      return;
    }
    let cancelled = false;
    setWindows([]);
    setLoading(true);
    setError(null);
    setLoadingOlder(false);
    const eligible = eligibleTranscripts(transcriptsRef.current);
    eligible.forEach((info) => pendingIdsRef.current.add(info.id));
    void (async () => {
      const results = await Promise.allSettled(
        eligible.map((info) => api.sessions.transcript(sessionId, transcriptParams(info, {})))
      );
      if (cancelled) return;
      const next: TranscriptWindow[] = [];
      let failures = 0;
      eligible.forEach((info, index) => {
        const result = results[index];
        pendingIdsRef.current.delete(info.id);
        if (result && result.status === "fulfilled") {
          next.push(windowFromResult(info, result.value));
          loadedIdsRef.current.add(info.id);
        } else {
          failures += 1;
        }
      });
      setWindows(next);
      setLoading(false);
      setError(
        eligible.length > 0 && failures === eligible.length ? "Failed to load transcripts" : null
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, enabled]);

  // Keep the loaded windows in sync with the (refreshed) transcripts list:
  // load transcripts that appeared later, drop ones that are no longer listed.
  useEffect(() => {
    if (!enabled) return;
    const eligible = eligibleTranscripts(transcripts);
    const eligibleIds = new Set(eligible.map((info) => info.id));
    setWindows((prev) => {
      const kept = prev.filter((window) => eligibleIds.has(window.source.id));
      if (kept.length === prev.length) return prev;
      for (const window of prev) {
        if (!eligibleIds.has(window.source.id)) {
          loadedIdsRef.current.delete(window.source.id);
          pendingIdsRef.current.delete(window.source.id);
        }
      }
      return kept;
    });
    const fresh = eligible.filter(
      (info) => !loadedIdsRef.current.has(info.id) && !pendingIdsRef.current.has(info.id)
    );
    if (fresh.length === 0) return;
    // `transcripts` is a new array every few seconds. This request must not be
    // tied to that identity: cancelling it on the next list refresh would leave
    // its ids marked pending forever and the transcript would never load. Only
    // a session change, disabling, or unmount makes the answer stale.
    const session = sessionId;
    const first = loadedIdsRef.current.size === 0;
    fresh.forEach((info) => pendingIdsRef.current.add(info.id));
    if (first) setLoading(true);
    void (async () => {
      const results = await Promise.allSettled(
        fresh.map((info) => api.sessions.transcript(session, transcriptParams(info, {})))
      );
      if (!aliveRef.current || sessionIdRef.current !== session || !enabledRef.current) return;
      const loaded = new Map<string, TranscriptWindow>();
      fresh.forEach((info, index) => {
        const result = results[index];
        pendingIdsRef.current.delete(info.id);
        if (result && result.status === "fulfilled") {
          loaded.set(info.id, windowFromResult(info, result.value));
          loadedIdsRef.current.add(info.id);
        }
      });
      if (first) {
        setLoading(false);
        if (loaded.size === 0) setError("Failed to load transcripts");
      }
      if (loaded.size === 0) return;
      setError(null);
      setWindows((prev) => {
        const byId = new Map(prev.map((window) => [window.source.id, window]));
        const next: TranscriptWindow[] = [];
        for (const info of eligible) {
          const window = byId.get(info.id) ?? loaded.get(info.id);
          if (window) next.push(window);
        }
        return next;
      });
    })();
  }, [transcripts, enabled, sessionId]);

  const refresh = useCallback(async () => {
    if (!enabledRef.current) return;
    if (refreshChainRef.current) {
      // One is already running: run exactly one more after it finishes.
      refreshQueuedRef.current = true;
      return;
    }
    const session = sessionIdRef.current;
    const run = async (): Promise<void> => {
      const current = windowsRef.current;
      await Promise.allSettled(
        current.map(async (window) => {
          const params =
            window.lastLine > 0
              ? transcriptParams(window.source, { after: window.lastLine })
              : transcriptParams(window.source, {});
          const result = await api.sessions.transcript(session, params);
          if (!aliveRef.current || sessionIdRef.current !== session || !enabledRef.current) {
            return;
          }
          const tail = window.lastLine > 0;
          setWindows((prev) =>
            prev.map((w) => {
              if (w.source.id !== window.source.id) return w;
              return tail
                ? appendMessages(w, result)
                : {
                    ...w,
                    messages: result.messages,
                    firstLine: result.first_line,
                    lastLine: result.last_line,
                    hasMore: result.has_more,
                  };
            })
          );
        })
      );
    };
    refreshChainRef.current = run().finally(() => {
      refreshChainRef.current = null;
      if (refreshQueuedRef.current) {
        refreshQueuedRef.current = false;
        void refresh();
      }
    });
    await refreshChainRef.current;
  }, []);

  const loadOlder = useCallback(async () => {
    if (!enabledRef.current || olderInFlightRef.current) return;
    const session = sessionIdRef.current;
    const targetId = mergeTranscripts(windowsRef.current).nextSourceId;
    if (!targetId) return;
    const window = windowsRef.current.find((w) => w.source.id === targetId);
    if (!window) return;
    olderInFlightRef.current = true;
    setLoadingOlder(true);
    try {
      const result = await api.sessions.transcript(
        session,
        transcriptParams(window.source, { before: window.firstLine })
      );
      if (!aliveRef.current || sessionIdRef.current !== session || !enabledRef.current) {
        return;
      }
      setWindows((prev) =>
        prev.map((w) => (w.source.id === targetId ? prependMessages(w, result) : w))
      );
    } finally {
      olderInFlightRef.current = false;
      if (aliveRef.current && sessionIdRef.current === session && enabledRef.current) {
        setLoadingOlder(false);
      }
    }
  }, []);

  // Live updates: WebSocket messages for this session, connection recovery,
  // and a 3 second poll while the tab is visible.
  useEffect(() => {
    if (!enabled) return;
    const concernsSession = (msg: WSMessage): boolean => {
      if (msg.type !== "new_event" && msg.type !== "session_updated") return false;
      const data = msg.data as { id?: string; session_id?: string } | undefined;
      return data?.session_id === sessionId || data?.id === sessionId;
    };
    const unsubscribe = eventBus.subscribe((msg) => {
      if (concernsSession(msg)) void refresh();
    });
    const offConnection = eventBus.onConnection((connected) => {
      if (connected) void refresh();
    });
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 3000);
    return () => {
      unsubscribe();
      offConnection();
      window.clearInterval(timer);
    };
  }, [enabled, sessionId, refresh]);

  const merged = useMemo(() => mergeTranscripts(windows), [windows]);

  return {
    messages: merged.messages,
    loading,
    error,
    hasMore: merged.nextSourceId !== null,
    heldBack: merged.heldBack,
    loadingOlder,
    loadOlder,
    refresh,
  };
}

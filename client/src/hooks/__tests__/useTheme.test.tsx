/**
 * @file useTheme.test.tsx
 * @description Tests for the useTheme hook: initial resolution from storage
 * and system preference, applying the dark class, persisting explicit
 * choices, and following live system-preference changes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStoredTheme, resolveTheme, useTheme, writeStoredTheme } from "../useTheme";

/**
 * Install a controllable `window.matchMedia` stub.
 * Returns a setter for the current `matches` value and a way to fire
 * the change listeners.
 */
function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<(e: { matches: boolean }) => void>();

  const mq = {
    get matches() {
      return matches;
    },
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener(_type: string, handler: (e: { matches: boolean }) => void) {
      listeners.add(handler);
    },
    removeEventListener(_type: string, handler: (e: { matches: boolean }) => void) {
      listeners.delete(handler);
    },
    dispatchEvent() {
      return false;
    },
  };

  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({ ...mq, media: query }),
    writable: true,
    configurable: true,
  });

  return {
    setMatches(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
  };
}

describe("useTheme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("readStoredTheme / writeStoredTheme", () => {
    it("round-trips a stored mode", () => {
      writeStoredTheme("light");
      expect(readStoredTheme()).toBe("light");
      writeStoredTheme("dark");
      expect(readStoredTheme()).toBe("dark");
    });

    it("falls back to system when nothing is stored", () => {
      expect(readStoredTheme()).toBe("system");
    });

    it("falls back to system when the stored value is invalid", () => {
      localStorage.setItem("agent-dashboard-theme", "neon");
      expect(readStoredTheme()).toBe("system");
    });
  });

  describe("resolveTheme", () => {
    it("returns the explicit mode unchanged", () => {
      installMatchMedia(false);
      expect(resolveTheme("dark")).toBe("dark");
      expect(resolveTheme("light")).toBe("light");
    });

    it("honours the system preference for the system mode", () => {
      installMatchMedia(true);
      expect(resolveTheme("system")).toBe("dark");
      installMatchMedia(false);
      expect(resolveTheme("system")).toBe("light");
    });
  });

  describe("hook behaviour", () => {
    it("defaults to the system preference and applies the dark class", () => {
      installMatchMedia(true);
      const { result } = renderHook(() => useTheme());
      expect(result.current.mode).toBe("system");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("applies light mode when the system prefers light", () => {
      installMatchMedia(false);
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("persists an explicit choice and applies it immediately", () => {
      installMatchMedia(false);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setMode("dark");
      });

      expect(result.current.mode).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
      expect(readStoredTheme()).toBe("dark");
    });

    it("switches back to light and removes the dark class", () => {
      installMatchMedia(true);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setMode("light");
      });

      expect(result.current.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(readStoredTheme()).toBe("light");
    });

    it("restores a stored explicit choice on mount", () => {
      installMatchMedia(false);
      writeStoredTheme("dark");
      const { result } = renderHook(() => useTheme());
      expect(result.current.mode).toBe("dark");
      expect(result.current.resolved).toBe("dark");
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    it("follows live system-preference changes while in system mode", () => {
      const mq = installMatchMedia(true);
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolved).toBe("dark");

      act(() => {
        mq.setMatches(false);
      });

      expect(result.current.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });

    it("ignores system changes once an explicit mode is chosen", () => {
      const mq = installMatchMedia(true);
      const { result } = renderHook(() => useTheme());

      act(() => {
        result.current.setMode("light");
      });

      act(() => {
        mq.setMatches(true);
      });

      expect(result.current.resolved).toBe("light");
      expect(document.documentElement.classList.contains("dark")).toBe(false);
    });
  });
});

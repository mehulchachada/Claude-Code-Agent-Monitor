/**
 * @file useTheme.ts
 * @description React hook that manages the dashboard's dark/light theme.
 * Reads the user's stored preference (localStorage), defaulting to dark
 * when nothing is stored, applies the `dark`/`light` class on `<html>`,
 * persists explicit choices, and tracks live system-preference changes.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

import { useCallback, useEffect, useState } from "react";

/** The three theme modes the user can choose. */
export type ThemeMode = "dark" | "light" | "system";

/** The resolved appearance actually applied to the document. */
export type ResolvedTheme = "dark" | "light";

/** localStorage key for the persisted theme choice. */
const STORAGE_KEY = "agent-dashboard-theme";

/**
 * Read the stored theme mode from localStorage.
 * Returns `"dark"` when nothing is stored or the value is invalid
 * (dark is the default; "system" is still a choice the user can make).
 */
export function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "dark" || raw === "light" || raw === "system") return raw;
  } catch {
    /* localStorage unavailable (SSR, privacy mode) – fall through */
  }
  return "dark";
}

/**
 * Persist the theme mode to localStorage.
 */
export function writeStoredTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore – non-critical */
  }
}

/**
 * Resolve a theme mode to the concrete appearance, honouring the system
 * preference when the mode is `"system"`.
 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== "system") return mode;
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "dark";
}

/**
 * Set the `dark`/`light` classes on the document root.
 */
function applyTheme(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.classList.toggle("light", resolved === "light");
}

/**
 * Hook that manages the dashboard theme.
 *
 * Returns the current mode, the resolved appearance, and a setter that
 * persists the choice and updates the DOM immediately.
 */
export function useTheme(): {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
} {
  const [mode, setModeState] = useState<ThemeMode>(() => readStoredTheme());
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolveTheme(mode));

  /** Apply the resolved theme to the DOM whenever it changes. */
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  /**
   * When the user has not made an explicit choice, track the system
   * preference so the theme follows OS-level changes live.
   */
  useEffect(() => {
    if (mode !== "system") return;
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      setResolved(e.matches ? "dark" : "light");
    };

    mq.addEventListener("change", handler);
    return () => {
      mq.removeEventListener("change", handler);
    };
  }, [mode]);

  /**
   * Set the theme mode, persist it, and update the resolved appearance.
   */
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    writeStoredTheme(next);
    setResolved(resolveTheme(next));
  }, []);

  return { mode, resolved, setMode };
}

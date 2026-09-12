"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { api, type Summary } from "@/lib/api";
import { readAccount } from "@/lib/account";

type Theme = "dark" | "light";

type ShellValue = {
  theme: Theme;
  toggleTheme: () => void;
  ambient: boolean;
  toggleAmbient: () => void;
  summary: Summary | null;
  refreshSummary: () => void;
  /** The workspace id every API call is scoped to. */
  account: string | null;
};

const ShellContext = createContext<ShellValue | null>(null);

export const THEME_KEY = "cw-theme";
export const AMBIENT_KEY = "cw-ambient";

/**
 * Reads and writes are wrapped because storage throws outright in some
 * contexts (private windows, embedded previews, browsers set to block
 * site data) rather than politely returning null -- and a theme
 * preference is not worth taking the whole app down for.
 */
function read(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* preference simply won't persist */
  }
}

/** How often the chrome re-checks for new work. The backend's own poll
 *  runs every 30s, so anything faster just asks the same question twice. */
const SUMMARY_POLL_MS = 30_000;

export function ShellProvider({ children }: { children: React.ReactNode }) {
  // Initialised from what the no-flash script already put on <html>, so
  // the first client render agrees with the server-sent markup instead
  // of flipping the theme after hydration.
  const [theme, setTheme] = useState<Theme>("dark");
  const [ambient, setAmbient] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    setTheme(read(THEME_KEY, "dark") === "light" ? "light" : "dark");
    setAmbient(read(AMBIENT_KEY, "on") !== "off");
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    write(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.ambient = ambient ? "on" : "off";
    write(AMBIENT_KEY, ambient ? "on" : "off");
  }, [ambient]);

  const [account, setAccount] = useState<string | null>(null);
  useEffect(() => setAccount(readAccount()), []);

  const refreshSummary = useCallback(() => {
    const id = readAccount();
    if (!id) return;
    api
      .summary(id)
      .then(setSummary)
      // Chrome-level polling: a failure here must never surface as an
      // error state over the page the user is actually reading. The
      // badge simply keeps its last known value.
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshSummary();
    const id = window.setInterval(refreshSummary, SUMMARY_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshSummary]);

  const value = useMemo<ShellValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === "dark" ? "light" : "dark")),
      ambient,
      toggleAmbient: () => setAmbient((a) => !a),
      summary,
      refreshSummary,
      account,
    }),
    [theme, ambient, summary, refreshSummary, account],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <ShellProvider>");
  return ctx;
}

/**
 * Runs before first paint so the page never flashes the wrong theme.
 * Inlined as a string because it has to execute ahead of React.
 */
export const PRELOAD_KEY = "cw-preloaded";

/**
 * Runs in <head>, before the browser paints anything.
 *
 * Theme and ambient were always decided here. The preloader now is too,
 * and for a sharper reason: it used to be switched on by a React effect,
 * which runs *after* the first paint -- so the onboarding form flashed
 * on screen for a frame before the panel dropped over it. An intro you
 * see the app behind is worse than no intro at all.
 *
 * Setting `data-preload` here means CSS can hide the content and show
 * the panel from the very first frame, with no JavaScript timing
 * involved. React only takes the attribute away when the animation is
 * done.
 */
export const NO_FLASH_SCRIPT = `
try {
  var t = localStorage.getItem('${THEME_KEY}');
  document.documentElement.dataset.theme = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.ambient =
    localStorage.getItem('${AMBIENT_KEY}') === 'off' ? 'off' : 'on';
} catch (e) {
  document.documentElement.dataset.theme = 'dark';
  document.documentElement.dataset.ambient = 'on';
}
try {
  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var seen = sessionStorage.getItem('${PRELOAD_KEY}') === '1';
  if (!reduced && !seen) {
    document.documentElement.dataset.preload = 'on';
    sessionStorage.setItem('${PRELOAD_KEY}', '1');
  }
} catch (e) {
  // Storage throws outright in private windows. Skipping the intro is
  // the safe failure here -- a panel that never lifts would hide the app.
}
`.trim();

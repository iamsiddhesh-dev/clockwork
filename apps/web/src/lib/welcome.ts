/**
 * What onboarding did, handed to the Overview so it can say so once.
 *
 * Kept in sessionStorage rather than the URL: it is shown a single time,
 * a refresh should not bring it back, and there is nothing in it worth
 * putting in someone's address bar or history.
 */

export const WELCOME_KEY = "cw-welcome";

export type WelcomeSummary = {
  /** Postings found, and per board. */
  found: number;
  sources: { label: string; fetched: number; ok: boolean }[];
  /** Links checked, and how many turned out to be closed or gone. */
  checked: number;
  closed: number;
  /** Leads scored against the person's work, and how many scored 60+. */
  scored: number;
  strong: number;
  /** A stage that didn't finish, said plainly. */
  problems: string[];
};

export function saveWelcome(summary: WelcomeSummary) {
  try {
    window.sessionStorage.setItem(WELCOME_KEY, JSON.stringify(summary));
  } catch {
    /* private window: the overview simply won't show the summary */
  }
}

export function readWelcomeRaw(): string | null {
  try {
    return window.sessionStorage.getItem(WELCOME_KEY);
  } catch {
    return null;
  }
}

export function clearWelcome() {
  try {
    window.sessionStorage.removeItem(WELCOME_KEY);
  } catch {
    /* nothing to clear */
  }
}

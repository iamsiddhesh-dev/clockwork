/**
 * Workspace identity, client side.
 *
 * There is no sign-in. Filling in the onboarding form creates a
 * workspace, and its id lives in a cookie from then on. Every API call
 * sends that id; the backend (apps/agent's auth.py) resolves it.
 *
 * The cookie is deliberately NOT httpOnly: server components read it to
 * decide routing, client components read it to call the API, and there
 * is no secret in it to protect -- the id *is* the access. That is the
 * trade this design makes, and auth.py's docstring states it in full.
 */

import { API_URL } from "./api";

export const ACCOUNT_COOKIE = "cw_account";

/** A year. Long enough that a judge revisiting the demo next week still
 *  lands in the workspace they set up, short enough to expire eventually. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function readAccount(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${ACCOUNT_COOKIE}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function writeAccount(id: string) {
  // `Secure` only when the page is already https -- setting it on plain
  // http (localhost, where this is developed and demoed) makes the
  // browser drop the cookie silently, which looks exactly like
  // onboarding failing to save.
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${ACCOUNT_COOKIE}=${encodeURIComponent(id)}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax${secure}`;
}

export function clearAccount() {
  document.cookie = `${ACCOUNT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

/** The one call onboarding makes before anything else. */
export async function createAccount(): Promise<string> {
  const res = await fetch(`${API_URL}/accounts`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not start a workspace (${res.status})`);
  const { account_id } = (await res.json()) as { account_id: string };
  writeAccount(account_id);
  return account_id;
}

/** Returns the current workspace, creating one if this browser has none. */
export async function ensureAccount(): Promise<string> {
  return readAccount() ?? (await createAccount());
}

/** For client components that must have a workspace already. Throws
 *  rather than silently creating one, so a bug never scatters empty
 *  workspaces behind the user's back. */
export function requireAccountClient(): string {
  const id = readAccount();
  if (!id) throw new Error("No workspace yet");
  return id;
}

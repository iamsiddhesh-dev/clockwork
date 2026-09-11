import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ACCOUNT_COOKIE } from "./account";

/**
 * Workspace identity, server side.
 *
 * Replaces the old `requireAccessToken()`. Same job -- hand a page the
 * string every API call needs -- but the string is now a workspace id
 * from a cookie rather than a verified session token. proxy.ts already
 * bounces cookie-less requests to onboarding; this checks again anyway,
 * for the same reason the auth version did: a matcher change should
 * never silently un-gate a page.
 */
export async function requireAccount(): Promise<string> {
  const store = await cookies();
  const id = store.get(ACCOUNT_COOKIE)?.value;
  if (!id) redirect("/onboarding");
  return id;
}

/** Whether this browser has a workspace at all, without redirecting. */
export async function maybeAccount(): Promise<string | null> {
  const store = await cookies();
  return store.get(ACCOUNT_COOKIE)?.value ?? null;
}

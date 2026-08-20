import { redirect } from "next/navigation";
import { createClient } from "./server";

/**
 * Server Component / Route Handler helper: get the current user's access
 * token, or redirect to /login. proxy.ts already redirects unauthenticated
 * requests before a page even renders, but Supabase's own guidance is not
 * to rely on that alone (a matcher change could silently stop covering a
 * route) -- every page that needs the token checks for real here too.
 */
export async function requireAccessToken(): Promise<string> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect("/login");
  }

  return session.access_token;
}

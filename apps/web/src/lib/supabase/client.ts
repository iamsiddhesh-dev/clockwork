"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client -- session lives in cookies (via @supabase/ssr),
 * kept in sync with the server client below by proxy.ts on every request.
 * Client Components (the Approval Inbox's poll/approve/reject/edit calls)
 * use this to get the current access token for calling the FastAPI
 * backend directly.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

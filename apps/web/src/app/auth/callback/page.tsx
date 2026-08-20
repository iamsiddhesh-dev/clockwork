"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// Magic-link landing spot. Has to be a client page, not a Route Handler:
// verified live that admin-generated test links (and possibly real
// signInWithOtp links, depending on flow config) return tokens in the
// URL *fragment* (`#access_token=...`), which never reaches the server
// at all -- a Route Handler reading searchParams would silently never
// see them. Also verified live that @supabase/ssr's createBrowserClient
// does NOT auto-detect a fragment on construction here (no PKCE
// code_verifier cookie exists for an admin-generated link, so there's
// nothing for its own detection to complete) -- so this parses the
// fragment and calls setSession() explicitly rather than assuming
// automatic detection worked. `?code=` (PKCE, what a real browser-issued
// signInWithOtp() call should produce) is handled too via
// exchangeCodeForSession.
function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const next = searchParams.get("next") ?? "/approvals";
    const code = searchParams.get("code");

    async function finish() {
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
      } else {
        const hashParams = new URLSearchParams(window.location.hash.slice(1));
        const access_token = hashParams.get("access_token");
        const refresh_token = hashParams.get("refresh_token");

        if (!access_token || !refresh_token) {
          setError("Sign-in link is invalid or has expired.");
          return;
        }

        const { error: setSessionError } = await supabase.auth.setSession({
          access_token,
          refresh_token,
        });
        if (setSessionError) {
          setError(setSessionError.message);
          return;
        }
      }
      router.replace(next);
    }
    finish();
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="text-center">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        <a href="/login" className="mt-2 inline-block text-sm underline">
          Back to sign in
        </a>
      </div>
    );
  }

  return <p className="text-sm text-zinc-500 dark:text-zinc-400">Signing you in…</p>;
}

export default function AuthCallbackPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Suspense fallback={null}>
        <AuthCallback />
      </Suspense>
    </div>
  );
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Magic-link landing spot, PKCE flow.
//
// This MUST be a server-side Route Handler, not a client page. A real
// browser-issued `signInWithOtp()` uses PKCE: @supabase/ssr stores a
// `code_verifier` in a cookie, the emailed link comes back with `?code=`,
// and `exchangeCodeForSession` needs to read that cookie to complete the
// exchange. A Route Handler is the only place that can both read the
// verifier cookie and write the resulting session cookies (Server
// Components can't set cookies at all).
//
// This was briefly a client page, which produced
// "PKCE code verifier not found in storage" for a real sign-in. That
// detour came from testing with `admin.generate_link()` -- an admin API
// that does NOT use PKCE and returns implicit-flow tokens in the URL
// *fragment*, which looks nothing like the real flow. Don't test this
// path with generate_link again; it proves nothing about what a real
// user hits.
//
// Note the inherent PKCE constraint: the verifier lives in a cookie on
// the browser that *requested* the link, so the link must be opened in
// that same browser. Opening it on a different device/browser fails by
// design. Moving to `?token_hash=` + `verifyOtp()` (needs the Supabase
// email template switched to {{ .TokenHash }}) is the cross-device fix
// if that ever matters for the demo.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // See the login page's note: "/" routes to onboarding or the inbox.
  const next = searchParams.get("next") ?? "/";

  // Supabase can redirect here with its own error (expired link, etc.)
  // rather than a code -- surface that instead of a generic failure.
  const supabaseError = searchParams.get("error_description") ?? searchParams.get("error");
  if (supabaseError) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(supabaseError)}`,
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Sign-in link was missing its code. Request a new one.")}`,
    );
  }

  // auth-js supports several concurrent PKCE flows: each stores its
  // verifier in a per-flow slot and tags its redirect URL with
  // `sb_flow_id`. It normally recovers that id from
  // `window.location.href` -- which does not exist server-side, so it
  // would silently fall back to a legacy fixed key that (per auth-js's
  // own comment) only "mirrors the most recently started flow".
  //
  // That fallback breaks a completely ordinary sequence: request a link,
  // don't see it, hit send again, then click the FIRST email. The fixed
  // key now holds the second flow's verifier, so the first link's code
  // gets exchanged against the wrong verifier -- and auth-js notes this
  // also burns the single-use auth code. Passing the id through from the
  // query string (a query param, so it does reach the server) makes the
  // lookup slot-exact, which is what the library intends.
  const flowId = searchParams.get("sb_flow_id");

  const supabase = await createClient();
  const { error } = flowId
    ? await supabase.auth.exchangeCodeForSession(code, { flowId })
    : await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}

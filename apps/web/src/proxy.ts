import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same mechanism,
// `middleware.js` is deprecated -- see node_modules/next/dist/docs).
//
// This does one thing: a browser with no workspace cookie has nothing to
// look at, so send it to onboarding, which is the front door. It does not
// verify anything -- the cookie is a workspace id, not a session, and
// auth.py is explicit that holding one identifies rather than
// authenticates.
const ACCOUNT_COOKIE = "cw_account";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Onboarding is where a cookie-less visitor is supposed to end up, so
  // it must never redirect to itself. Nor may /signin: someone whose
  // cookie is gone is *by definition* cookie-less, and gating the one
  // screen that gets it back would make losing a cookie unrecoverable --
  // which is the bug this whole route exists to fix. /intake is the
  // public lead-capture form -- the person filling it in is a stranger
  // with no workspace, which is the whole point of it.
  if (
    pathname.startsWith("/onboarding") ||
    pathname.startsWith("/signin") ||
    pathname.startsWith("/intake/")
  ) {
    return NextResponse.next();
  }

  if (!request.cookies.get(ACCOUNT_COOKIE)?.value) {
    return NextResponse.redirect(new URL("/onboarding", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Skip static assets and image optimization -- see proxy.ts docs on
    // why an unscoped matcher can silently block CSS/JS/images. Excludes
    // by file extension generally (any public/ asset), not just the
    // couple of Next.js defaults -- caught a real instance of this exact
    // gap while testing: a plain .txt file under public/ was getting
    // redirected instead of served.
    "/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|pdf|woff2?|css|js|map)$).*)",
  ],
};

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Next.js 16 renamed `middleware.ts` to `proxy.ts` (same mechanism,
// `middleware.js` is deprecated -- see node_modules/next/dist/docs).
//
// Refreshes the Supabase session cookie on every request (token refresh
// happens here, not in Server Components, which can't write cookies) and
// redirects unauthenticated visitors to /login. /login and /auth/callback
// stay reachable without a session -- everything else requires one.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = pathname.startsWith("/login") || pathname.startsWith("/auth/callback");

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip static assets and image optimization -- see proxy.ts docs on
    // why an unscoped matcher can silently block CSS/JS/images. Excludes
    // by file extension generally (any public/ asset), not just the
    // couple of Next.js defaults -- caught a real instance of this
    // exact gap while testing: a plain .txt file under public/ was
    // getting redirected to /login instead of served.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|pdf|woff2?|css|js|map)$).*)",
  ],
};

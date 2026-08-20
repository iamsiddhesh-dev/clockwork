import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Supabase client -- for Server Components and Route Handlers.
 * A new client per request, per @supabase/ssr's own docs ("always create
 * a new client with this function for each server render -- never share
 * a client across requests"). `setAll` is a no-op here: Server Components
 * can't write cookies (Next.js throws if you try outside a Route Handler
 * or Action), and proxy.ts is what actually refreshes the session cookie
 * on every request -- see that file's docstring.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component -- proxy.ts handles the
            // actual refresh; safe to ignore here.
          }
        },
      },
    },
  );
}

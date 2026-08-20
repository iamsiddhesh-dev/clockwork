"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ClockControl } from "./clock-control";

const LINKS = [
  { href: "/approvals", label: "Approval Inbox" },
  { href: "/threads", label: "Threads" },
  { href: "/deals", label: "Deals" },
  { href: "/runs", label: "Run Trace" },
];

export function Nav() {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  // No session yet (or on /login itself) -- skip the app chrome entirely.
  if (pathname.startsWith("/login") || pathname.startsWith("/auth/")) return null;

  return (
    <header className="border-b border-zinc-200 dark:border-zinc-800">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
        <span className="font-semibold tracking-tight">Clockwork</span>
        <nav className="flex gap-1">
          {LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                }`}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          <ClockControl />
          {email && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
              <span>{email}</span>
              <button
                onClick={signOut}
                className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/approvals";

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setError(null);

    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    if (signInError) {
      setStatus("error");
      setError(signInError.message);
    } else {
      setStatus("sent");
    }
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight">Clockwork</h1>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Sign in with a magic link -- no password.
      </p>

      {status === "sent" ? (
        <div className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          Check <strong>{email}</strong> for a sign-in link.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
          />
          <button
            type="submit"
            disabled={status === "sending"}
            className="rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {status === "sending" ? "Sending..." : "Send magic link"}
          </button>
          {status === "error" && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
    </div>
  );
}

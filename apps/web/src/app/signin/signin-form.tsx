"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn } from "@/lib/account";
import { Field } from "@/components/fields";

export function SignInForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(email);
      // `push` then `refresh`: the cookie was set a moment ago on the
      // client, and every page here is server-rendered from that cookie.
      // Without the refresh the first screen renders against the cached
      // cookie-less version and bounces straight back to onboarding.
      router.push("/overview");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 24 }}>
      <Field label="Email" htmlFor="signin-email" error={error}>
        <input
          id="signin-email"
          className="cw-input"
          type="email"
          autoComplete="email"
          autoFocus
          required
          placeholder="you@studio.com"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            // Clearing on edit rather than on submit: leaving "no
            // workspace with that email" under the box while they fix
            // the typo reads as if the new address failed too.
            if (error) setError(null);
          }}
        />
      </Field>

      <button
        type="submit"
        className="cw-btn cw-btn-primary"
        disabled={busy || !email.trim()}
        style={{ marginTop: 20, width: "100%", justifyContent: "center" }}
      >
        {busy ? "Opening…" : "Open my workspace"}
      </button>
    </form>
  );
}

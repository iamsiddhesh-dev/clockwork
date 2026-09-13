"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { requireAccountClient } from "@/lib/account";

/**
 * Where a client's answer comes back in.
 *
 * Clockwork doesn't read an inbox: replies reach the freelancer wherever
 * they applied from. Pasting one here saves it to the conversation and
 * wakes the agent to qualify the lead and draft the next reply.
 */
export function ReplyBox({ threadId }: { threadId: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "failed">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setState("sending");
    setError(null);
    try {
      const result = await api.logReply(requireAccountClient(), threadId, body);
      setBody("");
      setState(result.run_status === "completed" ? "done" : "failed");
      router.refresh();
    } catch (err) {
      setState("idle");
      setError(err instanceof Error ? err.message : "Something went wrong");
    }
  }

  const sending = state === "sending";

  return (
    <form onSubmit={submit} className="cw-card" style={{ padding: 22 }}>
      <div className="cw-label">Client replied?</div>
      <p style={{ margin: "8px 0 0", fontSize: 13.5, color: "var(--dim)" }}>
        Paste their message. The agent reads it and drafts your answer for approval.
      </p>
      <textarea
        className="cw-input"
        aria-label="Client's reply"
        style={{ marginTop: 14, minHeight: 110, resize: "vertical" }}
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          if (state !== "sending") setState("idle");
        }}
        placeholder="Thanks for reaching out — can you do it in three weeks? Budget is around $4k."
        disabled={sending}
      />
      <div className="cw-row" style={{ marginTop: 14, gap: 12 }}>
        <button className="cw-btn cw-btn-primary" disabled={sending || !body.trim()}>
          {sending ? "Reading…" : "Add reply"}
        </button>
        {sending && (
          <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>Usually under a minute.</span>
        )}
        {state === "done" && (
          <span style={{ fontSize: 13, color: "var(--ok)" }}>
            Saved. A draft reply is waiting in <Link href="/approvals">Approvals</Link>.
          </span>
        )}
        {state === "failed" && (
          <span style={{ fontSize: 13, color: "var(--warn)" }}>
            Saved, but the agent couldn&rsquo;t draft a reply. See <Link href="/runs">Runs</Link>.
          </span>
        )}
        {error && <span style={{ fontSize: 13, color: "var(--bad)" }}>{error}</span>}
      </div>
    </form>
  );
}

"use client";

import { useState } from "react";
import { API_URL } from "@/lib/api";
import { Logo } from "@/components/shell/icons";

type Stage = "form" | "sending" | "sent" | "error";

/**
 * The public side of the second trigger.
 *
 * Everything else in Clockwork is the freelancer's own screens. This is
 * the one page a stranger sees, so it carries none of the app chrome and
 * says nothing about the pipeline behind it.
 *
 * The submit is deliberately synchronous: posting here wakes the agent,
 * which qualifies the lead and drafts a reply before responding. That
 * takes the better part of a minute, and rather than hide it behind a
 * spinner that implies "saving", the wait is named for what it is. A
 * client who sees "reading your message now" understands the pause;
 * one who sees a spinner assumes the form is broken.
 */
export function IntakeForm({
  account,
  freelancer,
}: {
  account: string;
  freelancer: { name: string; title: string | null; positioning: string | null } | null;
}) {
  const [stage, setStage] = useState<Stage>("form");
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ contact_name: "", contact_email: "", message: "" });

  const invalid =
    !form.contact_name.trim() ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.contact_email.trim()) ||
    form.message.trim().length < 20;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (invalid) return;
    setStage("sending");
    setError(null);
    try {
      const response = await fetch(`${API_URL}/intake/${account}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!response.ok) throw new Error(await response.text().catch(() => `HTTP ${response.status}`));
      setStage("sent");
    } catch (err) {
      setError((err as Error).message);
      setStage("error");
    }
  }

  if (stage === "sent") {
    return (
      <Frame freelancer={freelancer}>
        <div className="cw-label">Received</div>
        <h1 className="cw-h1" style={{ marginTop: 12 }}>
          That&rsquo;s with {freelancer?.name?.split(" ")[0] ?? "them"} now.
        </h1>
        <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--dim)", maxWidth: "50ch" }}>
          Your message has been read and a reply is already drafted &mdash; but nothing is sent
          automatically. {freelancer?.name?.split(" ")[0] ?? "They"} will look at it and get back to
          you.
        </p>
      </Frame>
    );
  }

  return (
    <Frame freelancer={freelancer}>
      <div className="cw-label">Get in touch</div>
      <h1 className="cw-h1" style={{ marginTop: 12 }}>
        Tell {freelancer?.name?.split(" ")[0] ?? "them"} what you need.
      </h1>
      {freelancer?.positioning && (
        <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.6, color: "var(--dim)", maxWidth: "54ch" }}>
          {freelancer.positioning}
        </p>
      )}

      <form onSubmit={submit} style={{ marginTop: 28, display: "flex", flexDirection: "column", gap: 18 }}>
        <label style={{ display: "block" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Your name</span>
          <input
            className="cw-input"
            style={{ marginTop: 8 }}
            value={form.contact_name}
            onChange={(e) => setForm({ ...form, contact_name: e.target.value })}
            placeholder="Priya Shah"
            autoComplete="name"
            disabled={stage === "sending"}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Your email</span>
          <input
            className="cw-input"
            style={{ marginTop: 8 }}
            type="email"
            value={form.contact_email}
            onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
            placeholder="priya@example.com"
            autoComplete="email"
            disabled={stage === "sending"}
          />
        </label>

        <label style={{ display: "block" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>What do you need?</span>
          <span style={{ display: "block", marginTop: 3, fontSize: 12, color: "var(--quiet)", lineHeight: 1.5 }}>
            What the work is, roughly when, and a budget if you have one. Detail here means a
            useful first reply instead of three rounds of questions.
          </span>
          <textarea
            className="cw-input"
            style={{ marginTop: 8, minHeight: 150, resize: "vertical" }}
            value={form.message}
            onChange={(e) => setForm({ ...form, message: e.target.value })}
            placeholder="We run a small design agency and our client invoicing is still in spreadsheets. We'd like to move to Stripe with recurring retainer billing, ideally within a month. Budget is around $5k."
            disabled={stage === "sending"}
          />
        </label>

        <div className="cw-row">
          <button className="cw-btn cw-btn-primary" disabled={invalid || stage === "sending"}>
            {stage === "sending" ? "Reading your message…" : "Send"}
          </button>
          {stage === "sending" && (
            <span style={{ fontSize: 12.5, color: "var(--quiet)" }}>
              This takes about a minute — it is being read properly, not queued.
            </span>
          )}
          {error && (
            <span style={{ fontSize: 13, color: "var(--bad)", flex: "1 1 100%" }}>
              That didn&rsquo;t go through: {error}
            </span>
          )}
        </div>
      </form>
    </Frame>
  );
}

function Frame({
  children,
  freelancer,
}: {
  children: React.ReactNode;
  freelancer: { name: string; title: string | null } | null;
}) {
  return (
    <div style={{ width: "100%", maxWidth: 680, margin: "0 auto", padding: "40px 0" }}>
      <div className="cw-row" style={{ gap: 10, marginBottom: 28 }}>
        <Logo size={24} />
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.01em" }}>
            {freelancer?.name ?? "Clockwork"}
          </div>
          {freelancer?.title && (
            <div style={{ fontSize: 12.5, color: "var(--quiet)" }}>{freelancer.title}</div>
          )}
        </div>
      </div>
      <div className="cw-card cw-enter" style={{ padding: "clamp(22px, 4vw, 36px)" }}>
        {children}
      </div>
    </div>
  );
}

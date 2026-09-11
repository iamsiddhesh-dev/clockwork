"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import { api, type Opportunity, type Source } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { requireAccountClient } from "@/lib/account";
import { Empty } from "@/components/ui";

const SOURCE_LABEL: Record<string, string> = {
  hacker_news: "Hacker News",
  remotive: "Remotive",
  remoteok: "RemoteOK",
};

/** Fit is a 0-100 ranking, so it gets a colour ramp rather than a badge:
 *  the point is comparing postings against each other, not bucketing. */
function fitColor(score: number | null) {
  if (score === null) return "var(--quiet)";
  if (score >= 70) return "var(--ok)";
  if (score >= 40) return "var(--warn)";
  return "var(--quiet)";
}

const STATUS_LABEL: Record<Opportunity["status"], string> = {
  new: "unscored",
  scored: "scored",
  pitched: "pitch drafted",
  dismissed: "dismissed",
  converted: "became a deal",
};

export function OpportunityList({
  initial,
  sources,
  hasProfile,
}: {
  initial: Opportunity[];
  sources: Source[];
  hasProfile: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceKind = useCallback(
    (id: string | null) => sources.find((s) => s.id === id)?.kind ?? "",
    [sources],
  );

  const refresh = useCallback(async () => {
    setItems(await api.listOpportunities(requireAccountClient()));
  }, []);

  const run = useCallback(
    async (key: string, fn: (account: string) => Promise<string | null>) => {
      setBusy(key);
      setError(null);
      setNote(null);
      try {
        const message = await fn(requireAccountClient());
        if (message) setNote(message);
        await refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  async function handleDismiss(id: string) {
    setItems((prev) => prev.filter((o) => o.id !== id));
    try {
      await api.dismissOpportunity(requireAccountClient(), id);
    } catch (err) {
      setError((err as Error).message);
      await refresh();
    }
  }

  const visible = items
    .filter((o) => o.status !== "dismissed")
    .sort((a, b) => (b.fit_score ?? -1) - (a.fit_score ?? -1));
  const unscored = visible.filter((o) => o.fit_score === null).length;

  return (
    <>
      <div className="cw-row">
        <button
          className="cw-btn cw-btn-primary"
          disabled={busy !== null}
          onClick={() =>
            run("sync", async (account) => {
              const report = await api.syncOpportunities(account);
              // Report per source rather than a bare total: a feed that
              // errored otherwise looks identical to one with nothing new.
              const parts = report.sources.map((s) =>
                s.ok
                  ? `${SOURCE_LABEL[s.kind] ?? s.kind} ${s.fetched}`
                  : `${SOURCE_LABEL[s.kind] ?? s.kind} failed`,
              );
              return `Fetched ${report.total} — ${parts.join(" · ")}`;
            })
          }
        >
          {busy === "sync" ? "Fetching…" : "Fetch leads"}
        </button>

        <button
          className="cw-btn"
          disabled={busy !== null || !hasProfile || unscored === 0}
          title={
            !hasProfile
              ? "Fill in your profile first — scoring compares postings against it"
              : unscored === 0
                ? "Nothing left to score"
                : undefined
          }
          onClick={() =>
            run("score", async (account) => {
              const res = await api.scoreOpportunities(account, 10);
              return res.failed > 0
                ? `Scored ${res.scored}, ${res.failed} failed (usually a rate limit — try again).`
                : `Scored ${res.scored}.`;
            })
          }
        >
          {busy === "score" ? "Scoring…" : `Score fit${unscored ? ` (${unscored} left)` : ""}`}
        </button>

        {note && <span style={{ fontSize: 12.5, color: "var(--dim)" }}>{note}</span>}
        {error && <span style={{ fontSize: 12.5, color: "var(--bad)" }}>{error}</span>}
      </div>

      {!hasProfile && (
        <div
          className="cw-card"
          style={{ padding: 18, borderColor: "var(--orange-bd)", background: "var(--orange-bg)" }}
        >
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: "var(--sub)" }}>
            No profile yet. Fetching leads works, but fit scoring can&rsquo;t run — there is nothing
            to measure a posting against.{" "}
            <Link href="/settings" style={{ color: "var(--orange-ink)", fontWeight: 600 }}>
              Fill it in
            </Link>
            .
          </p>
        </div>
      )}

      {visible.length === 0 ? (
        <Empty title="Nothing sourced yet">
          Hit <strong>Fetch leads</strong> to pull live contract postings from Hacker News, Remotive
          and RemoteOK.
        </Empty>
      ) : (
        <div className="cw-stack">
          {visible.map((opportunity) => {
            const evidence = opportunity.fit_evidence?.evidence ?? [];
            const concerns = opportunity.fit_evidence?.concerns ?? [];
            const canPitch =
              hasProfile &&
              opportunity.fit_score !== null &&
              opportunity.status === "scored";

            return (
              <article key={opportunity.id} className="cw-card" style={{ padding: 24 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
                  <div style={{ flex: "1 1 340px", minWidth: 0 }}>
                    <div className="cw-label">
                      {SOURCE_LABEL[sourceKind(opportunity.source_id)] ?? "Unknown source"}
                      {opportunity.author ? ` · ${opportunity.author}` : ""}
                      {opportunity.posted_at ? ` · ${formatDate(opportunity.posted_at)}` : ""}
                    </div>

                    <h2
                      style={{
                        margin: "14px 0 0",
                        fontSize: 19,
                        fontWeight: 600,
                        letterSpacing: "-0.03em",
                        lineHeight: 1.25,
                        maxWidth: "34ch",
                        textWrap: "balance",
                      }}
                    >
                      {opportunity.title ?? "Untitled posting"}
                    </h2>

                    {opportunity.fit_rationale && (
                      <p
                        style={{
                          margin: "14px 0 0",
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          color: "var(--dim)",
                          maxWidth: "58ch",
                        }}
                      >
                        {opportunity.fit_rationale}
                      </p>
                    )}

                    {(evidence.length > 0 || concerns.length > 0) && (
                      <ul
                        style={{
                          listStyle: "none",
                          margin: "18px 0 0",
                          padding: 0,
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        {evidence.map((line, i) => (
                          <li
                            key={`e${i}`}
                            style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5, color: "var(--sub)" }}
                          >
                            <span className="cw-mono" style={{ color: "var(--ok)", flex: "none" }}>
                              +
                            </span>
                            {line}
                          </li>
                        ))}
                        {concerns.map((line, i) => (
                          <li
                            key={`c${i}`}
                            style={{ display: "flex", gap: 10, fontSize: 13, lineHeight: 1.5, color: "var(--quiet)" }}
                          >
                            <span className="cw-mono" style={{ flex: "none" }}>
                              −
                            </span>
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}

                    <details style={{ marginTop: 16 }}>
                      <summary
                        style={{ cursor: "pointer", fontSize: 12.5, color: "var(--quiet)" }}
                      >
                        Show the posting
                      </summary>
                      <pre
                        className="cw-scroll-x"
                        style={{
                          margin: "10px 0 0",
                          maxHeight: 260,
                          overflowY: "auto",
                          whiteSpace: "pre-wrap",
                          border: "1px solid var(--rim)",
                          background: "var(--sheet)",
                          borderRadius: 12,
                          padding: 14,
                          fontFamily: "inherit",
                          fontSize: 12.5,
                          lineHeight: 1.6,
                          color: "var(--dim)",
                        }}
                      >
                        {opportunity.body}
                      </pre>
                    </details>

                    <div className="cw-row" style={{ gap: 9, marginTop: 20 }}>
                      {opportunity.status === "pitched" ? (
                        <Link href="/approvals" className="cw-btn cw-btn-sm cw-btn-primary">
                          Pitch waiting for you
                        </Link>
                      ) : (
                        <button
                          className="cw-btn cw-btn-sm cw-btn-primary"
                          disabled={!canPitch || busy !== null}
                          title={
                            !hasProfile
                              ? "A pitch has to cite your portfolio — fill in your profile first"
                              : opportunity.fit_score === null
                                ? "Score it first, so the pitch has evidence to cite"
                                : undefined
                          }
                          onClick={() =>
                            run(`pitch-${opportunity.id}`, async (account) => {
                              await api.pitchOpportunity(account, opportunity.id);
                              return "Pitch drafted — waiting in the Approval Inbox. Nothing was sent.";
                            })
                          }
                        >
                          {busy === `pitch-${opportunity.id}` ? "Writing…" : "Draft a pitch"}
                        </button>
                      )}

                      {opportunity.url && (
                        // RemoteOK's licence requires attribution wherever
                        // its results are shown -- this link is that, not
                        // decoration.
                        <a
                          href={opportunity.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="cw-btn cw-btn-sm cw-btn-quiet"
                        >
                          View original
                        </a>
                      )}
                      <button
                        className="cw-btn cw-btn-sm cw-btn-quiet"
                        onClick={() => handleDismiss(opportunity.id)}
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>

                  <div style={{ flex: "0 0 auto", display: "flex", gap: 26, alignItems: "flex-start" }}>
                    <div>
                      <div className="cw-label">Fit</div>
                      <div
                        className="cw-num"
                        style={{
                          marginTop: 10,
                          fontSize: 34,
                          letterSpacing: "-0.045em",
                          color: fitColor(opportunity.fit_score),
                        }}
                      >
                        {opportunity.fit_score ?? "—"}
                      </div>
                      <div className="cw-mono" style={{ marginTop: 8, fontSize: 11, color: "var(--quiet)" }}>
                        {STATUS_LABEL[opportunity.status]}
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}

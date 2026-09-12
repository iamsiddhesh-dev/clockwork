"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type SearchResult } from "@/lib/api";
import { readAccount } from "@/lib/account";
import { Empty } from "@/components/ui";

const KIND_LABEL: Record<string, string> = {
  opportunity: "Posting",
  thread: "Conversation",
  message: "Message",
  deal: "Deal",
  invoice: "Invoice",
  run: "Run",
};

const KIND_TONE: Record<string, string> = {
  opportunity: "var(--blue)",
  thread: "var(--ok)",
  message: "var(--ok)",
  deal: "var(--orange-ink)",
  invoice: "var(--warn)",
  run: "var(--quiet)",
};

/** Long enough that a fast typist isn't issuing a query per keystroke,
 *  short enough that results feel immediate. */
const DEBOUNCE_MS = 250;

export function SearchView() {
  const router = useRouter();
  const params = useSearchParams();
  const initial = params.get("q") ?? "";

  const [query, setQuery] = useState(initial);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Guards against an older, slower response landing after a newer one
  // and overwriting it -- the classic search race that shows results for
  // a query the user has already moved on from.
  const latest = useRef(0);

  const run = useCallback(async (term: string) => {
    const ticket = ++latest.current;
    const account = readAccount();
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.search(account, term);
      if (ticket === latest.current) setResult(res);
    } catch (err) {
      if (ticket === latest.current) {
        setError((err as Error).message);
        setResult(null);
      }
    } finally {
      if (ticket === latest.current) setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResult(null);
      return;
    }
    const id = window.setTimeout(() => run(query), DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [query, run]);

  // Keep the URL honest, so a search can be shared or reloaded.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const next = query.trim() ? `/search?q=${encodeURIComponent(query.trim())}` : "/search";
      router.replace(next);
    }, DEBOUNCE_MS * 2);
    return () => window.clearTimeout(id);
  }, [query, router]);

  const hits = result?.hits ?? [];

  return (
    <>
      <div className="cw-card" style={{ padding: 22 }}>
        <label style={{ display: "block" }}>
          <span className="cw-label">Search everything</span>
          <input
            className="cw-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="A client, a posting, an invoice number, something a run said…"
            style={{ marginTop: 10, fontSize: 15, padding: "12px 14px" }}
          />
        </label>
        <p style={{ margin: "12px 0 0", fontSize: 12.5, color: "var(--quiet)" }}>
          Postings, conversations, messages, deals, invoices and runs — all at once.
        </p>
      </div>

      {/* An error and an empty state must never appear together. "Nothing
          matches" is a claim about the data, and it cannot be made when
          the search never reached the data. */}
      {error ? (
        <div className="cw-card" style={{ padding: 40, borderColor: "var(--bad)" }}>
          <div className="cw-label" style={{ color: "var(--bad)" }}>
            The search didn&rsquo;t run
          </div>
          <p style={{ margin: "12px 0 0", fontSize: 14, lineHeight: 1.6, color: "var(--dim)", maxWidth: "54ch" }}>
            This is a connection problem, not an empty workspace — nothing has been ruled out.
          </p>
          <p className="cw-mono" style={{ margin: "10px 0 0", fontSize: 11.5, color: "var(--quiet)" }}>
            {error}
          </p>
          <button className="cw-btn" style={{ marginTop: 18 }} onClick={() => run(query)}>
            Try again
          </button>
        </div>
      ) : query.trim().length < 2 ? (
        <Empty title="Type to search">
          Two characters is enough. A single one matches half the workspace and tells you nothing.
        </Empty>
      ) : hits.length === 0 && !busy && result !== null ? (
        <Empty title={`Nothing matches “${query.trim()}”`}>
          This searched every posting, conversation, message, deal, invoice and run in the
          workspace — so a blank result here really does mean it is not there.
        </Empty>
      ) : (
        <div className="cw-card" style={{ overflow: "hidden", opacity: busy ? 0.6 : 1 }}>
          {hits.map((hit) => (
            <Link
              key={`${hit.kind}-${hit.id}`}
              href={hit.href}
              className="cw-row"
              style={{ gap: 12, padding: "14px 20px", borderBottom: "1px solid var(--rim)" }}
            >
              <span
                className="cw-status"
                style={{ flex: "none", width: 92, color: KIND_TONE[hit.kind] ?? "var(--quiet)" }}
              >
                {KIND_LABEL[hit.kind] ?? hit.kind}
              </span>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{hit.title}</div>
                {hit.subtitle && (
                  <div style={{ marginTop: 4, fontSize: 12.5, color: "var(--quiet)" }}>
                    {hit.subtitle}
                  </div>
                )}
              </div>
              {hit.meta && (
                <span className="cw-mono" style={{ flex: "none", fontSize: 11, color: "var(--quiet)" }}>
                  {hit.meta}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

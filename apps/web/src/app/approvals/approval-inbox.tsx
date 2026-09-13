"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type Approval } from "@/lib/api";
import { readAccount } from "@/lib/account";
import { Empty } from "@/components/ui";
import { actionVerb, subjectOf, workflowOf } from "./labels";

const POLL_MS = 5000;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

export function ApprovalInbox({ initialApprovals }: { initialApprovals: Approval[] }) {
  const router = useRouter();
  const [approvals, setApprovals] = useState<Approval[]>(initialApprovals);
  const [selected, setSelected] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Don't clobber a card mid-edit out from under the user -- re-created
  // (and the interval below re-subscribed) whenever editingId flips,
  // which just resets the poll timer, not a real cost at a 5s cadence.
  const refresh = useCallback(() => {
    if (editingId !== null) return;
    const account = readAccount();
    if (!account) return;
    api
      .listApprovals(account, "pending")
      .then(setApprovals)
      .catch(() => {
        /* transient poll failure -- keep stale data rather than blanking */
      });
  }, [editingId]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Derived, not synced via effect: clamp instead of storing an
  // out-of-range index when the list shrinks after approve/reject.
  const safeSelected = Math.min(selected, Math.max(approvals.length - 1, 0));

  const decide = useCallback(
    async (approval: Approval, verb: "approve" | "reject") => {
      setBusyId(approval.id);
      setError(null);
      // Optimistic: the card goes immediately, and is put back if the
      // call fails. Waiting on a round trip for every keypress makes the
      // keyboard flow feel broken.
      setApprovals((prev) => prev.filter((a) => a.id !== approval.id));
      try {
        const account = readAccount();
        if (!account) throw new Error("No workspace");
        await (verb === "approve"
          ? api.approve(account, approval.id)
          : api.reject(account, approval.id));
        // The decided list below is server-rendered, so it only learns
        // about this decision on a refresh. Without one, approving made
        // the card vanish with nowhere on screen saying what became of it.
        router.refresh();
      } catch (err) {
        setApprovals((prev) => [approval, ...prev]);
        setError(`Couldn't ${verb}: ${(err as Error).message}`);
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  const startEdit = (approval: Approval) => {
    setEditingId(approval.id);
    setDraft(typeof approval.payload.body === "string" ? approval.payload.body : "");
  };

  const saveEdit = async (approval: Approval) => {
    setError(null);
    try {
      const account = readAccount();
      if (!account) throw new Error("No workspace");
      const updated = await api.editApproval(account, approval.id, { body: draft });
      setApprovals((prev) => prev.map((a) => (a.id === approval.id ? updated : a)));
    } catch (err) {
      setError(`Couldn't save edit: ${(err as Error).message}`);
    } finally {
      setEditingId(null);
    }
  };

  // a / r / e on the selected card, j/k or arrows to move selection.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (editingId !== null) {
        if (e.key === "Escape") setEditingId(null);
        return;
      }
      const active = document.activeElement;
      if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

      const current = approvals[safeSelected];
      if (!current) return;

      if (e.key === "a") {
        e.preventDefault();
        decide(current, "approve");
      } else if (e.key === "r") {
        e.preventDefault();
        decide(current, "reject");
      } else if (e.key === "e") {
        e.preventDefault();
        startEdit(current);
      } else if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, approvals.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [approvals, safeSelected, editingId, decide]);

  if (approvals.length === 0) {
    return (
      <Empty title="Nothing waiting on you">
        Anything the agent wants to send a client appears here first.
      </Empty>
    );
  }

  return (
    <>
      {error && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: "var(--bad)",
            border: "1px solid var(--rim)",
            borderRadius: 12,
            padding: "10px 14px",
          }}
        >
          {error}
        </p>
      )}

      <div className="cw-stack">
        {approvals.map((approval, index) => {
          const isSelected = index === safeSelected;
          const isEditing = editingId === approval.id;
          const isBusy = busyId === approval.id;
          const subject = subjectOf(approval);
          const changes = Object.entries(approval.state_diff ?? {});

          return (
            <article
              key={approval.id}
              onClick={() => setSelected(index)}
              style={{
                cursor: "pointer",
                border: `1px solid ${isSelected ? "var(--rim2)" : "var(--rim)"}`,
                borderRadius: "var(--r-card)",
                background: "var(--glass)",
                backdropFilter: "blur(16px)",
                boxShadow: isSelected
                  ? "var(--hi), 0 18px 50px -28px rgba(0,0,0,.9)"
                  : "var(--hi)",
                opacity: isBusy ? 0.5 : 1,
                transition: "border-color var(--t), box-shadow var(--t), opacity var(--t)",
              }}
            >
              <div className="cw-approval-grid">
                <div style={{ minWidth: 0, padding: 24 }}>
                  <div className="cw-row" style={{ gap: 10 }}>
                    <span
                      className="cw-status"
                      style={{
                        color: approval.risk === "high" ? "var(--bad)" : "var(--warn)",
                      }}
                    >
                      {approval.risk} risk
                    </span>
                    <span style={{ width: 1, height: 11, background: "var(--rim2)" }} />
                    <span className="cw-mono" style={{ fontSize: 11, color: "var(--quiet)" }}>
                      {workflowOf(approval.action_type)}
                    </span>
                    <time
                      className="cw-mono"
                      style={{ marginLeft: "auto", fontSize: 11, color: "var(--quiet)" }}
                      dateTime={approval.created_at}
                    >
                      {timeOf(approval.created_at)}
                    </time>
                  </div>

                  <h2
                    style={{
                      margin: "16px 0 0",
                      fontSize: 20,
                      fontWeight: 600,
                      letterSpacing: "-0.028em",
                      lineHeight: 1.3,
                    }}
                  >
                    {actionVerb(approval.action_type)}
                  </h2>
                  {subject && (
                    <p style={{ margin: "6px 0 0", fontSize: 13.5, color: "var(--dim)" }}>
                      {subject}
                    </p>
                  )}
                  {approval.rationale && (
                    <p
                      style={{
                        margin: "14px 0 0",
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        color: "var(--sub)",
                        maxWidth: "62ch",
                      }}
                    >
                      {approval.rationale}
                    </p>
                  )}

                  {isEditing ? (
                    <textarea
                      className="cw-input"
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      style={{
                        marginTop: 18,
                        minHeight: 220,
                        fontSize: 13,
                        lineHeight: 1.7,
                        resize: "vertical",
                      }}
                    />
                  ) : (
                    <pre
                      style={{
                        margin: "18px 0 0",
                        whiteSpace: "pre-wrap",
                        border: "1px solid var(--rim)",
                        background: "var(--sheet)",
                        borderRadius: 14,
                        padding: 18,
                        fontFamily: "inherit",
                        fontSize: 13,
                        lineHeight: 1.7,
                        color: "var(--sub)",
                        boxShadow: "var(--hi)",
                      }}
                    >
                      {String(approval.payload.body ?? "(no body)")}
                    </pre>
                  )}

                  <div className="cw-row" style={{ gap: 9, marginTop: 18 }}>
                    {isEditing ? (
                      <>
                        <button
                          className="cw-btn cw-btn-primary"
                          onClick={() => saveEdit(approval)}
                        >
                          Save edit
                        </button>
                        <button className="cw-btn" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="cw-btn cw-btn-primary"
                          disabled={isBusy}
                          onClick={() => decide(approval, "approve")}
                        >
                          Approve
                        </button>
                        <button
                          className="cw-btn"
                          disabled={isBusy}
                          onClick={() => decide(approval, "reject")}
                        >
                          Reject
                        </button>
                        <button className="cw-btn cw-btn-quiet" onClick={() => startEdit(approval)}>
                          Edit
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* The rail: what it read, and what changes if you say yes.
                    Every figure here is a stored value -- there is no
                    invented confidence score. */}
                <div className="cw-approval-rail">
                  <div>
                    <div className="cw-label">Evidence</div>
                    <div className="cw-num" style={{ marginTop: 10, fontSize: 23 }}>
                      {approval.citations?.length ?? 0}
                    </div>
                    <div style={{ marginTop: 6, fontSize: 12.5, color: "var(--quiet)" }}>
                      sources read
                    </div>
                  </div>

                  <div>
                    <div className="cw-label">If you approve</div>
                    <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
                      {changes.length === 0 ? (
                        <li style={{ fontSize: 13, color: "var(--quiet)" }}>no recorded change</li>
                      ) : (
                        changes.map(([key, value]) => (
                          <li
                            key={key}
                            style={{ fontSize: 12.5, lineHeight: 1.6, color: "var(--dim)" }}
                          >
                            <span className="cw-mono" style={{ color: "var(--quiet)" }}>
                              {key}
                            </span>{" "}
                            {String(value)}
                          </li>
                        ))
                      )}
                    </ul>
                  </div>

                  <div>
                    <div className="cw-label">Sent?</div>
                    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.55, color: "var(--dim)" }}>
                      Not yet. Nothing sends until you approve.
                    </div>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}

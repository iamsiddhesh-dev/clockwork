"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Approval } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

const POLL_MS = 5000;

const RISK_STYLES: Record<Approval["risk"], string> = {
  medium: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  high: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

function actionVerb(actionType: string) {
  switch (actionType) {
    case "send_email":
      return "Send this reply";
    default:
      return `Run ${actionType}`;
  }
}

export function ApprovalInbox({ initialApprovals }: { initialApprovals: Approval[] }) {
  const [approvals, setApprovals] = useState<Approval[]>(initialApprovals);
  const [selected, setSelected] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supabase = useMemo(() => createClient(), []);
  // Fetched fresh before every call rather than cached once -- a session
  // open long enough for the access token to expire and silently refresh
  // (Supabase handles the refresh; we just need to not be holding a stale
  // copy of the old token when that happens).
  const getToken = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) throw new Error("Not signed in");
    return session.access_token;
  }, [supabase]);

  // Don't clobber a card mid-edit out from under the user -- re-created (and
  // the interval below re-subscribed) whenever editingId flips, which just
  // resets the poll timer, not a real cost at a 5s cadence.
  const refresh = useCallback(() => {
    if (editingId !== null) return;
    getToken()
      .then((token) => api.listApprovals(token, "pending"))
      .then(setApprovals)
      .catch(() => {
        /* transient poll failure -- keep showing stale data rather than blank */
      });
  }, [editingId, getToken]);

  useEffect(() => {
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  // Derived, not synced via effect: clamp instead of storing an
  // out-of-range index when the list shrinks (e.g. after approve/reject).
  const safeSelected = Math.min(selected, Math.max(approvals.length - 1, 0));

  const removeLocally = (id: string) => setApprovals((prev) => prev.filter((a) => a.id !== id));

  const handleApprove = useCallback(
    async (approval: Approval) => {
      setBusyId(approval.id);
      setError(null);
      removeLocally(approval.id);
      try {
        const token = await getToken();
        await api.approve(token, approval.id);
      } catch (err) {
        setApprovals((prev) => [approval, ...prev]);
        setError(`Couldn't approve: ${(err as Error).message}`);
      } finally {
        setBusyId(null);
      }
    },
    [getToken],
  );

  const handleReject = useCallback(
    async (approval: Approval) => {
      setBusyId(approval.id);
      setError(null);
      removeLocally(approval.id);
      try {
        const token = await getToken();
        await api.reject(token, approval.id);
      } catch (err) {
        setApprovals((prev) => [approval, ...prev]);
        setError(`Couldn't reject: ${(err as Error).message}`);
      } finally {
        setBusyId(null);
      }
    },
    [getToken],
  );

  const startEdit = (approval: Approval) => {
    setEditingId(approval.id);
    setDraft(typeof approval.payload.body === "string" ? approval.payload.body : "");
  };

  const saveEdit = async (approval: Approval) => {
    setError(null);
    try {
      const token = await getToken();
      const updated = await api.editApproval(token, approval.id, { body: draft });
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
        handleApprove(current);
      } else if (e.key === "r") {
        e.preventDefault();
        handleReject(current);
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
  }, [approvals, safeSelected, editingId, handleApprove, handleReject]);

  return (
    <div className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-700">↑↓</kbd> navigate ·{" "}
          <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-700">a</kbd> approve ·{" "}
          <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-700">r</kbd> reject ·{" "}
          <kbd className="rounded border border-zinc-300 px-1 dark:border-zinc-700">e</kbd> edit
        </p>
        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>

      {approvals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 py-16 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Nothing waiting on you. Clockwork is either idle or already caught up.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {approvals.map((approval, i) => {
            const isSelected = i === safeSelected;
            const isEditing = editingId === approval.id;
            const isBusy = busyId === approval.id;

            return (
              <li
                key={approval.id}
                onClick={() => setSelected(i)}
                className={`cursor-pointer rounded-lg border p-4 transition-colors ${
                  isSelected
                    ? "border-zinc-900 bg-white dark:border-zinc-100 dark:bg-zinc-900"
                    : "border-zinc-200 bg-white/60 dark:border-zinc-800 dark:bg-zinc-900/40"
                } ${isBusy ? "opacity-50" : ""}`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <span className="font-medium">{actionVerb(approval.action_type)}</span>
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${RISK_STYLES[approval.risk]}`}
                    >
                      {approval.risk} risk
                    </span>
                  </div>
                  <time className="shrink-0 text-xs text-zinc-400">
                    {formatDateTime(approval.created_at)}
                  </time>
                </div>

                {approval.rationale && (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    <span className="font-medium text-zinc-500 dark:text-zinc-500">Why: </span>
                    {approval.rationale}
                  </p>
                )}

                {isEditing ? (
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        saveEdit(approval);
                      }
                    }}
                    rows={8}
                    className="mt-3 w-full rounded-md border border-zinc-300 bg-white p-3 font-mono text-sm dark:border-zinc-700 dark:bg-zinc-950"
                  />
                ) : (
                  typeof approval.payload.body === "string" && (
                    <pre className="mt-3 whitespace-pre-wrap rounded-md bg-zinc-50 p-3 font-sans text-sm dark:bg-zinc-950">
                      {approval.payload.body}
                    </pre>
                  )
                )}

                <div className="mt-3 flex items-center justify-between text-xs text-zinc-400">
                  <span>
                    What changes: {Object.entries(approval.state_diff).map(([k, v]) => `${k}=${String(v)}`).join(", ") || "—"}
                  </span>
                  <span>Read {approval.citations.length} message{approval.citations.length === 1 ? "" : "s"}</span>
                </div>

                <div className="mt-3 flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => saveEdit(approval)}
                        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
                      >
                        Save (⌘⏎)
                      </button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm dark:border-zinc-700"
                      >
                        Cancel (Esc)
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        disabled={isBusy}
                        onClick={() => handleApprove(approval)}
                        className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Approve (a)
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => handleReject(approval)}
                        className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                      >
                        Reject (r)
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => startEdit(approval)}
                        className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-zinc-700"
                      >
                        Edit (e)
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { api, type AgentEvent } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const KIND_STYLES: Record<string, string> = {
  tool_call: "border-sky-200 dark:border-sky-900",
  tool_result: "border-emerald-200 dark:border-emerald-900",
  decision: "border-amber-200 dark:border-amber-900",
  error: "border-red-200 dark:border-red-900",
  model_call: "border-violet-200 dark:border-violet-900",
};

const KIND_LABELS: Record<string, string> = {
  tool_call: "called",
  tool_result: "returned",
  decision: "decision",
  error: "error",
  model_call: "model call",
};

function EventCard({ event }: { event: AgentEvent }) {
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li className={`rounded-lg border p-3 text-sm ${KIND_STYLES[event.kind] ?? "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-xs uppercase tracking-wide text-zinc-400">
          #{event.seq} · {KIND_LABELS[event.kind] ?? event.kind}
        </span>
        <span className="flex items-center gap-2 text-xs text-zinc-400">
          {event.latency_ms != null && <span>{event.latency_ms}ms</span>}
          {event.cost_usd != null && <span>${event.cost_usd.toFixed(6)}</span>}
        </span>
      </div>

      {event.tool_name && <p className="mt-1 font-medium">{event.tool_name}</p>}
      {event.rationale && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{event.rationale}</p>}
      {hasPayload && (
        <pre className="mt-2 max-h-64 overflow-auto rounded-md bg-zinc-50 p-2 font-mono text-xs text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </li>
  );
}

export function RunTrace({ runId, initialStatus }: { runId: string; initialStatus: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [connectionError, setConnectionError] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let source: EventSource | null = null;
    let cancelled = false;

    createClient()
      .auth.getSession()
      .then(({ data: { session } }) => {
        if (cancelled || !session) return;

        source = new EventSource(api.runEventsUrl(session.access_token, runId));
        source.onmessage = (e) => {
          const event: AgentEvent = JSON.parse(e.data);
          if (seenIds.current.has(event.id)) return;
          seenIds.current.add(event.id);
          setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));
        };
        source.onerror = () => setConnectionError(true);
      });

    // Poll the run's own status separately -- the SSE stream only ever
    // carries agent_event rows, not the parent run's status, and the
    // stream closes itself once the run finishes (see api.py).
    const statusPoll = setInterval(() => {
      createClient()
        .auth.getSession()
        .then(({ data: { session } }) => {
          if (!session) return;
          return api.getRun(session.access_token, runId);
        })
        .then((run) => {
          if (run) setStatus(run.status);
        })
        .catch(() => {});
    }, 2000);

    return () => {
      cancelled = true;
      source?.close();
      clearInterval(statusPoll);
    };
  }, [runId]);

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
        <span
          className={`h-2 w-2 rounded-full ${status === "running" ? "animate-pulse bg-amber-500" : status === "failed" ? "bg-red-500" : "bg-emerald-500"}`}
        />
        {status === "running" ? "live" : status}
        {connectionError && <span className="text-red-500">· stream reconnecting</span>}
      </div>

      {events.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 py-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          Waiting for events…
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((event) => (
            <EventCard key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

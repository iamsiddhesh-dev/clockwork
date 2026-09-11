"use client";

import { useEffect, useRef, useState } from "react";
import { api, type AgentEvent } from "@/lib/api";
import { readAccount } from "@/lib/account";
import { Empty } from "@/components/ui";

const KIND: Record<string, { dot: string; label: string; weight: number }> = {
  model_call: { dot: "var(--quiet)", label: "model call", weight: 500 },
  tool_call: { dot: "var(--blue)", label: "called", weight: 600 },
  tool_result: { dot: "var(--ok)", label: "returned", weight: 500 },
  decision: { dot: "var(--orange)", label: "decision", weight: 600 },
  error: { dot: "var(--bad)", label: "error", weight: 600 },
};

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function Event({ event, last }: { event: AgentEvent; last: boolean }) {
  const kind = KIND[event.kind] ?? { dot: "var(--quiet)", label: event.kind, weight: 500 };
  const hasPayload = event.payload && Object.keys(event.payload).length > 0;

  return (
    <li style={{ display: "grid", gridTemplateColumns: "74px 20px minmax(0, 1fr)", paddingBottom: 24 }}>
      <span
        className="cw-mono"
        style={{ fontSize: 11, lineHeight: 1.4, color: "var(--quiet)", paddingTop: 1 }}
      >
        {timeOf(event.created_at)}
      </span>

      {/* The rail: a dot per event, joined by a hairline. The last event
          gets no tail, so the timeline visibly ends rather than trailing
          off into the padding. */}
      <span style={{ position: "relative", display: "block" }}>
        {!last && (
          <span
            style={{
              position: "absolute",
              left: 3,
              top: 15,
              bottom: -24,
              width: 1,
              background: "var(--rim)",
            }}
          />
        )}
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 3,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: kind.dot,
          }}
        />
      </span>

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: kind.weight, lineHeight: 1.4 }}>
          {event.tool_name ?? kind.label}
          {event.tool_name && (
            <span className="cw-mono" style={{ marginLeft: 8, fontSize: 11, color: "var(--quiet)" }}>
              {kind.label}
            </span>
          )}
        </div>

        {event.rationale && (
          <p style={{ margin: "5px 0 0", fontSize: 13, lineHeight: 1.55, color: "var(--dim)" }}>
            {event.rationale}
          </p>
        )}

        {hasPayload && (
          <pre
            className="cw-mono cw-scroll-x"
            style={{
              margin: "10px 0 0",
              maxHeight: 220,
              overflowY: "auto",
              border: "1px solid var(--rim)",
              borderRadius: 12,
              background: "var(--sheet)",
              padding: "12px 14px",
              fontSize: 11,
              lineHeight: 1.65,
              color: "var(--dim)",
            }}
          >
            {JSON.stringify(event.payload, null, 2)}
          </pre>
        )}

        {(event.latency_ms != null || event.cost_usd != null) && (
          <div
            className="cw-mono"
            style={{ marginTop: 7, fontSize: 11, color: "var(--quiet)" }}
          >
            {[
              event.latency_ms != null ? `${event.latency_ms}ms` : null,
              event.cost_usd != null ? `$${event.cost_usd.toFixed(6)}` : null,
              event.input_tokens != null && event.output_tokens != null
                ? `${event.input_tokens}→${event.output_tokens} tok`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        )}
      </div>
    </li>
  );
}

export function RunTrace({ runId, initialStatus }: { runId: string; initialStatus: string }) {
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [status, setStatus] = useState(initialStatus);
  const [connectionError, setConnectionError] = useState(false);
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    const account = readAccount();
    if (!account) return;

    const source = new EventSource(api.runEventsUrl(account, runId));
    source.onmessage = (e) => {
      const event: AgentEvent = JSON.parse(e.data);
      if (seenIds.current.has(event.id)) return;
      seenIds.current.add(event.id);
      setEvents((prev) => [...prev, event].sort((a, b) => a.seq - b.seq));
    };
    source.onerror = () => setConnectionError(true);

    // Poll the run's own status separately -- the SSE stream only ever
    // carries agent_event rows, not the parent run's status, and the
    // stream closes itself once the run finishes (see api.py).
    const statusPoll = setInterval(() => {
      api
        .getRun(account, runId)
        .then((run) => setStatus(run.status))
        .catch(() => {});
    }, 2000);

    return () => {
      source.close();
      clearInterval(statusPoll);
    };
  }, [runId]);

  const tone =
    status === "running" ? "var(--warn)" : status === "failed" ? "var(--bad)" : "var(--ok)";

  return (
    <div className="cw-card" style={{ padding: 24 }}>
      <div className="cw-row" style={{ gap: 9 }}>
        <span
          className={`cw-dot ${status === "running" ? "cw-dot-live" : ""}`}
          style={{ background: tone }}
        />
        <span
          className="cw-mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--dim)",
          }}
        >
          {status === "running" ? "live" : status}
          {events.length > 0 ? ` · ${events.length} events` : ""}
        </span>
        {connectionError && status === "running" && (
          <span className="cw-mono" style={{ fontSize: 11, color: "var(--warn)" }}>
            stream reconnecting
          </span>
        )}
      </div>

      {events.length === 0 ? (
        <div style={{ marginTop: 20 }}>
          <Empty title={status === "running" ? "Waiting for events" : "No events recorded"}>
            {status === "running"
              ? "The stream is open. Steps appear here as the agent takes them."
              : "This run finished without writing any audit events."}
          </Empty>
        </div>
      ) : (
        <ol style={{ listStyle: "none", margin: "24px 0 0", padding: 0 }}>
          {events.map((event, index) => (
            <Event key={event.id} event={event} last={index === events.length - 1} />
          ))}
        </ol>
      )}
    </div>
  );
}

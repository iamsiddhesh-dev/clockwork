/**
 * Thin client for the Clockwork agent API (apps/agent). Every call needs
 * the caller's Supabase access token -- the backend verifies it and
 * derives user_id from it (see apps/agent/src/clockwork/auth.py); there
 * is no more client-supplied user_id anywhere in this file.
 */

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export type Approval = {
  id: string;
  user_id: string;
  run_id: string | null;
  action_type: string;
  risk: "medium" | "high";
  payload: { thread_id?: string; body?: string; [key: string]: unknown };
  rationale: string | null;
  citations: string[];
  state_diff: Record<string, unknown>;
  status: "pending" | "approved" | "rejected" | "executed" | "failed";
  decided_at: string | null;
  executed_at: string | null;
  created_at: string;
};

export type Thread = {
  id: string;
  user_id: string;
  contact_name: string | null;
  contact_email: string | null;
  channel: string;
  status: "open" | "closed";
  last_message_at: string | null;
  created_at: string;
};

export type Message = {
  id: string;
  thread_id: string;
  user_id: string;
  direction: "inbound" | "outbound";
  body: string;
  sent_at: string;
  created_at: string;
};

export type Deal = {
  id: string;
  user_id: string;
  thread_id: string;
  intent: string | null;
  stage: "new" | "qualified" | "quoted" | "won" | "lost";
  score: "hot" | "warm" | "cold" | null;
  score_rationale: string | null;
  estimated_value: number | null;
  source: string | null;
  next_action: string | null;
  next_action_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AgentRun = {
  id: string;
  user_id: string;
  trigger_type: "message" | "schedule" | "manual";
  trigger_ref: string | null;
  status: "running" | "completed" | "failed";
  started_at: string;
  completed_at: string | null;
  outcome: string | null;
  total_cost_usd: number;
  error: string | null;
};

export type AgentEvent = {
  id: string;
  run_id: string;
  user_id: string;
  seq: number;
  kind: "model_call" | "tool_call" | "tool_result" | "decision" | "error";
  tool_name: string | null;
  payload: Record<string, unknown>;
  rationale: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  created_at: string;
};

async function apiFetch<T>(path: string, accessToken: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...init?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listApprovals: (accessToken: string, status = "pending") =>
    apiFetch<Approval[]>(`/approvals?status=${status}`, accessToken, { cache: "no-store" }),
  approve: (accessToken: string, id: string) =>
    apiFetch<{ status: string }>(`/approvals/${id}/approve`, accessToken, { method: "POST" }),
  reject: (accessToken: string, id: string) =>
    apiFetch<{ status: string }>(`/approvals/${id}/reject`, accessToken, { method: "POST" }),
  editApproval: (accessToken: string, id: string, payload: Record<string, unknown>) =>
    apiFetch<Approval>(`/approvals/${id}`, accessToken, {
      method: "PATCH",
      body: JSON.stringify({ payload }),
    }),

  listThreads: (accessToken: string) =>
    apiFetch<Thread[]>(`/threads`, accessToken, { cache: "no-store" }),
  getThread: (accessToken: string, id: string) =>
    apiFetch<{ thread: Thread; messages: Message[]; deal: Deal | null }>(`/threads/${id}`, accessToken, {
      cache: "no-store",
    }),

  listDeals: (accessToken: string) => apiFetch<Deal[]>(`/deals`, accessToken, { cache: "no-store" }),

  listRuns: (accessToken: string, limit = 30) =>
    apiFetch<AgentRun[]>(`/runs?limit=${limit}`, accessToken, { cache: "no-store" }),
  getRun: (accessToken: string, id: string) =>
    apiFetch<AgentRun>(`/runs/${id}`, accessToken, { cache: "no-store" }),

  /** Not an apiFetch call -- EventSource can't send an Authorization
   * header, so the token rides in the query string instead (matches
   * apps/agent's /runs/{id}/events route). */
  runEventsUrl: (accessToken: string, runId: string) =>
    `${API_URL}/runs/${runId}/events?token=${encodeURIComponent(accessToken)}`,

  clock: (accessToken: string) => apiFetch<{ now: string }>(`/clock`, accessToken, { cache: "no-store" }),
  advanceClock: (accessToken: string, days: number) =>
    apiFetch<{ now: string; fired: unknown[] }>(`/clock/advance`, accessToken, {
      method: "POST",
      body: JSON.stringify({ days }),
    }),
  resetClock: (accessToken: string) =>
    apiFetch<{ now: string }>(`/clock/reset`, accessToken, { method: "POST" }),
};

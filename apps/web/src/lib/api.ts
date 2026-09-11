/**
 * Thin client for the Clockwork agent API (apps/agent).
 *
 * Every call takes the caller's workspace id as its first argument and
 * sends it as `X-Clockwork-Account`. There is no sign-in and no token:
 * the id comes from a cookie set during onboarding (see lib/account.ts),
 * and apps/agent's auth.py resolves it -- and is explicit that this
 * identifies a workspace rather than authenticating a person.
 *
 * The first parameter is still named `account` everywhere rather than
 * being threaded through some context, so it stays obvious at each call
 * site that a request is scoped to one workspace.
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

export type PortfolioItem = {
  title: string;
  summary: string;
  tags?: string[];
};

export type Profile = {
  id?: string;
  user_id?: string;
  name: string;
  /** The headline under the name, Upwork-style: "Backend engineer ·
   *  payments". Frames every pitch and sharpens fit scoring. */
  title: string | null;
  /** Contact data, not a credential -- nothing signs in with it. */
  email: string | null;
  skills: string[];
  years_experience: number | null;
  rates: { hourly?: number; currency?: string; [key: string]: unknown };
  /** The floor. score_fit marks a posting down when its budget is
   *  clearly under this. */
  min_project_budget: number | null;
  /** Hours a week genuinely available -- what separates a freelancer
   *  from a job applicant, and what catches full-time roles wearing a
   *  contract label. */
  availability_hours: number | null;
  /** Stored as `positioning`; presented as "Overview". */
  positioning: string | null;
  voice_samples: string[];
  portfolio: PortfolioItem[];
  payment_terms: string | null;
  timezone?: string | null;
};

export type Opportunity = {
  id: string;
  user_id: string;
  source_id: string | null;
  external_id: string;
  title: string | null;
  body: string | null;
  url: string | null;
  author: string | null;
  posted_at: string | null;
  fit_score: number | null;
  fit_rationale: string | null;
  fit_evidence: { evidence?: string[]; concerns?: string[] } | null;
  status: "new" | "scored" | "pitched" | "dismissed" | "converted";
  deal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Source = {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  last_fetched_at: string | null;
  last_error: string | null;
};

export type SyncReport = {
  total: number;
  sources: { kind: string; ok: boolean; fetched?: number; error?: string }[];
};

export type KickoffResult = {
  sourced: SyncReport;
  scored: { scored: number; failed: number };
  pitched: { opportunity_id: string; approval_id: string }[];
  pitch_errors: { opportunity_id: string; error: string }[];
};

export type QuoteLineItem = {
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  amount: number;
};

export type Quote = {
  id: string;
  user_id: string;
  deal_id: string;
  currency: string;
  line_items: QuoteLineItem[];
  subtotal: number;
  total: number;
  timeline: string | null;
  assumptions: string[];
  exclusions: string[];
  payment_terms: string | null;
  valid_until: string | null;
  status: "draft" | "sent" | "accepted" | "declined" | "expired";
  sent_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Invoice = {
  id: string;
  user_id: string;
  deal_id: string;
  quote_id: string | null;
  number: string;
  currency: string;
  amount: number;
  line_items: QuoteLineItem[];
  payment_terms: string | null;
  status: "draft" | "sent" | "paid" | "void";
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  chase_count: number;
  last_chased_at: string | null;
  created_at: string;
  updated_at: string;
};

/** chase_payment returns one of two shapes: it drafted a reminder, or it
 * correctly decided there was nothing to chase. */
export type ChaseResult =
  | { action: "none"; reason: string }
  | {
      action: "chase_drafted";
      approval_id: string;
      invoice_id: string;
      days_overdue: number;
      body: string;
    };

export type Summary = {
  now: string;
  pending_approvals: number;
  running: boolean;
  spent_today_usd: number;
  daily_cap_usd: number;
  pending_tasks: number;
  next_task: { kind: string; due_at: string; reason: string | null } | null;
};

export type Workflow = {
  key: string;
  name: string;
  blurb: string;
  tools: string[];
  state: string;
  tone: "pending" | "done" | "idle";
  waiting: number;
  last_at: string | null;
  /** What the lane actually produced -- opportunities, pitches, quotes,
   *  reminders. Counted from domain rows, not from the event log. */
  produced: number;
  calls: number;
  cost_usd: number;
};

export type Overview = {
  summary: Summary;
  metrics: {
    opportunities_scored: number;
    opportunities_strong: number;
    opportunities_total: number;
    pending_approvals: number;
    quotes_out: number;
    quotes_accepted: number;
    outstanding_usd: number;
    collected_usd: number;
    overdue_count: number;
    avg_days_to_paid: number | null;
  };
  runs: {
    total: number;
    success_rate: number | null;
    last_at: string | null;
    recent: AgentRun[];
  };
  workflows: Workflow[];
  activity: {
    id: string;
    run_id: string;
    kind: string;
    tool: string | null;
    text: string;
    cost_usd: number | null;
    at: string;
  }[];
  cost_series: { day: string; usd: number }[];
  scheduled: {
    kind: string;
    subject_type: string;
    due_at: string;
    reason: string | null;
  }[];
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

async function apiFetch<T>(path: string, account: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Clockwork-Account": account,
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
  listApprovals: (account: string, status = "pending") =>
    apiFetch<Approval[]>(`/approvals?status=${status}`, account, { cache: "no-store" }),
  approve: (account: string, id: string) =>
    apiFetch<{ status: string }>(`/approvals/${id}/approve`, account, { method: "POST" }),
  reject: (account: string, id: string) =>
    apiFetch<{ status: string }>(`/approvals/${id}/reject`, account, { method: "POST" }),
  editApproval: (account: string, id: string, payload: Record<string, unknown>) =>
    apiFetch<Approval>(`/approvals/${id}`, account, {
      method: "PATCH",
      body: JSON.stringify({ payload }),
    }),

  listThreads: (account: string) =>
    apiFetch<Thread[]>(`/threads`, account, { cache: "no-store" }),
  getThread: (account: string, id: string) =>
    apiFetch<{ thread: Thread; messages: Message[]; deal: Deal | null }>(`/threads/${id}`, account, {
      cache: "no-store",
    }),

  summary: (account: string) =>
    apiFetch<Summary>(`/summary`, account, { cache: "no-store" }),
  overview: (account: string) =>
    apiFetch<Overview>(`/overview`, account, { cache: "no-store" }),

  listDeals: (account: string) => apiFetch<Deal[]>(`/deals`, account, { cache: "no-store" }),
  quoteDeal: (account: string, dealId: string) =>
    apiFetch<{ approval_id: string; quote_id: string; total: number; currency: string; body: string }>(
      `/deals/${dealId}/quote`,
      account,
      { method: "POST" },
    ),

  listQuotes: (account: string) =>
    apiFetch<Quote[]>(`/quotes`, account, { cache: "no-store" }),
  /** Human-only: the agent has no tool for these three. */
  acceptQuote: (account: string, id: string) =>
    apiFetch<Quote>(`/quotes/${id}/accepted`, account, { method: "POST" }),
  declineQuote: (account: string, id: string) =>
    apiFetch<Quote>(`/quotes/${id}/declined`, account, { method: "POST" }),
  invoiceQuote: (account: string, id: string) =>
    apiFetch<{ approval_id: string; invoice_id: string; number: string; body: string }>(
      `/quotes/${id}/invoice`,
      account,
      { method: "POST" },
    ),

  listInvoices: (account: string) =>
    apiFetch<Invoice[]>(`/invoices`, account, { cache: "no-store" }),
  markInvoicePaid: (account: string, id: string) =>
    apiFetch<Invoice>(`/invoices/${id}/paid`, account, { method: "POST" }),
  chaseInvoice: (account: string, id: string) =>
    apiFetch<ChaseResult>(`/invoices/${id}/chase`, account, { method: "POST" }),

  listOpportunities: (account: string) =>
    apiFetch<Opportunity[]>(`/opportunities`, account, { cache: "no-store" }),
  listSources: (account: string) =>
    apiFetch<Source[]>(`/sources`, account, { cache: "no-store" }),
  syncOpportunities: (account: string) =>
    apiFetch<SyncReport>(`/opportunities/sync`, account, { method: "POST" }),
  scoreOpportunities: (account: string, limit = 10) =>
    apiFetch<{ scored: number; failed: number }>(`/opportunities/score`, account, {
      method: "POST",
      body: JSON.stringify({ limit }),
    }),
  pitchOpportunity: (account: string, id: string) =>
    apiFetch<{ approval_id: string; opportunity_id: string; body: string }>(
      `/opportunities/${id}/pitch`,
      account,
      { method: "POST" },
    ),
  /** Onboarding's one call: source, score, and pitch the best match. */
  kickoff: (account: string, scoreLimit = 10, pitchTop = 1) =>
    apiFetch<KickoffResult>(`/kickoff`, account, {
      method: "POST",
      body: JSON.stringify({ score_limit: scoreLimit, pitch_top: pitchTop }),
    }),
  dismissOpportunity: (account: string, id: string) =>
    apiFetch<Opportunity>(`/opportunities/${id}/dismiss`, account, { method: "POST" }),

  getProfile: (account: string) =>
    apiFetch<Profile | null>(`/profile`, account, { cache: "no-store" }),
  saveProfile: (account: string, profile: Omit<Profile, "id" | "user_id">) =>
    apiFetch<Profile>(`/profile`, account, { method: "PUT", body: JSON.stringify(profile) }),

  listRuns: (account: string, limit = 30) =>
    apiFetch<AgentRun[]>(`/runs?limit=${limit}`, account, { cache: "no-store" }),
  getRun: (account: string, id: string) =>
    apiFetch<AgentRun>(`/runs/${id}`, account, { cache: "no-store" }),

  /** Not an apiFetch call -- EventSource can't send custom headers, so
   * the workspace id rides in the query string instead (matches
   * apps/agent's /runs/{id}/events route). */
  runEventsUrl: (account: string, runId: string) =>
    `${API_URL}/runs/${runId}/events?account=${encodeURIComponent(account)}`,

  clock: (account: string) => apiFetch<{ now: string }>(`/clock`, account, { cache: "no-store" }),
  advanceClock: (account: string, days: number) =>
    apiFetch<{ now: string; fired: unknown[] }>(`/clock/advance`, account, {
      method: "POST",
      body: JSON.stringify({ days }),
    }),
  resetClock: (account: string) =>
    apiFetch<{ now: string }>(`/clock/reset`, account, { method: "POST" }),
};

-- Clockwork — migration 002: operational tables
-- Adds the runtime scaffolding the agent needs: run/event audit trail,
-- the approval queue, the unified task scheduler, the cost ledger, and
-- per-user app settings (incl. the virtual clock offset).

create extension if not exists pgcrypto;

-- ── agent_run ───────────────────────────────────────────────────────────
-- One row per invocation of run_agent(), whatever triggered it.
create table agent_run (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    trigger_type      text not null,   -- 'message' | 'schedule' | 'manual'
    trigger_ref       text,            -- e.g. message id / task id that fired this run
    status            text not null default 'running',  -- running|completed|failed
    started_at        timestamptz not null default now(),
    completed_at      timestamptz,
    outcome           text,
    total_cost_usd    numeric default 0,
    error             text
);

-- ── agent_event ─────────────────────────────────────────────────────────
-- The full audit trail: every model call, tool call/result, decision, and
-- error within a run, in order. This powers the Run Trace view.
create table agent_event (
    id                uuid primary key default gen_random_uuid(),
    run_id            uuid not null references agent_run(id) on delete cascade,
    user_id           uuid not null references auth.users(id) on delete cascade,
    seq               integer not null,
    kind              text not null,   -- model_call|tool_call|tool_result|decision|error
    tool_name         text,
    payload           jsonb default '{}',
    rationale          text,
    latency_ms        integer,
    input_tokens      integer,
    output_tokens     integer,
    cost_usd          numeric,
    created_at        timestamptz not null default now()
);

-- ── approval ────────────────────────────────────────────────────────────
-- Medium/high-risk actions never execute directly -- they queue here and
-- wait for a human decision. Four fields (action, rationale, citations,
-- state_diff) are what make the Approval Inbox read as an employee
-- reporting to you, not a chatbot guessing.
create table approval (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    run_id            uuid references agent_run(id) on delete set null,
    action_type       text not null,   -- e.g. 'send_email' | 'send_quote' | 'send_invoice'
    risk              text not null,   -- 'medium' | 'high'
    payload           jsonb not null default '{}',
    rationale         text,
    citations         jsonb default '[]',
    state_diff        jsonb default '{}',
    status            text not null default 'pending',  -- pending|approved|rejected|executed|failed
    decided_at        timestamptz,
    executed_at       timestamptz,
    created_at        timestamptz not null default now()
);

-- ── task ────────────────────────────────────────────────────────────────
-- Unified scheduler queue -- the worker loop's tick() pulls due tasks and
-- fires run_agent(trigger=schedule) for each.
create table task (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    kind              text not null,   -- e.g. 'follow_up' | 'invoice_chase'
    subject_type      text not null,   -- e.g. 'deal' | 'invoice'
    subject_id        uuid not null,
    due_at            timestamptz not null,
    status            text not null default 'pending',  -- pending|done|cancelled|failed
    attempts          integer not null default 0,
    payload           jsonb default '{}',
    idempotency_key   text unique,
    created_at        timestamptz not null default now()
);

-- ── token_ledger ────────────────────────────────────────────────────────
-- Every model call, for cost tracking and the daily spend cap.
create table token_ledger (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    run_id            uuid references agent_run(id) on delete set null,
    role              text not null,    -- orchestrator|writer|extractor
    model_id          text not null,
    input_tokens      integer not null default 0,
    output_tokens     integer not null default 0,
    cost_usd          numeric not null default 0,
    created_at        timestamptz not null default now()
);

-- ── app_setting ─────────────────────────────────────────────────────────
-- One row per user. Holds the virtual clock offset (the demo's "Advance
-- 5 days" control) and the daily spend cap for the ledger's degrade path.
create table app_setting (
    user_id                   uuid primary key references auth.users(id) on delete cascade,
    clock_offset_seconds      bigint not null default 0,
    daily_spend_cap_usd       numeric not null default 5,
    updated_at                timestamptz not null default now()
);

-- ── indexes ─────────────────────────────────────────────────────────────
create index idx_agent_run_user          on agent_run (user_id);
create index idx_agent_event_run         on agent_event (run_id, seq);
create index idx_agent_event_user        on agent_event (user_id);
create index idx_approval_user_status    on approval (user_id, status);
create index idx_task_user_status_due    on task (user_id, status, due_at);
create index idx_token_ledger_user       on token_ledger (user_id);
create index idx_token_ledger_run        on token_ledger (run_id);

-- ── row level security ──────────────────────────────────────────────────
alter table agent_run    enable row level security;
alter table agent_event  enable row level security;
alter table approval     enable row level security;
alter table task         enable row level security;
alter table token_ledger enable row level security;
alter table app_setting  enable row level security;

create policy "agent_run_owner" on agent_run
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "agent_event_owner" on agent_event
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "approval_owner" on approval
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "task_owner" on task
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "token_ledger_owner" on token_ledger
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "app_setting_owner" on app_setting
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

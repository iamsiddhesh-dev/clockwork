-- Clockwork — initial schema
-- Covers just enough for the Phase 1 checkpoint loop:
--   a message arrives -> deal created, scored, reply drafted -> appears
--   in the Approval Inbox.
-- Remaining tables (quote, project, scope_item, invoice, approval,
-- agent_run, agent_event, token_ledger, source, opportunity, contact)
-- follow in later migrations as each phase needs them.

create extension if not exists pgcrypto;

-- ── profile ─────────────────────────────────────────────────────────────
-- One row per freelancer (the account owner). Holds everything the agent
-- needs to ground its own reasoning: skills, rates, portfolio, voice.
create table profile (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    name              text not null,
    skills            text[] default '{}',
    rates             jsonb default '{}',   -- e.g. { "hourly": 60, "currency": "USD" }
    positioning       text,
    voice_samples     jsonb default '[]',   -- past outbound messages, for tone-matching
    portfolio         jsonb default '[]',   -- case studies the agent cites when pitching
    payment_terms     text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- ── thread ──────────────────────────────────────────────────────────────
-- One conversation with one prospective or existing client.
create table thread (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    contact_name      text,
    contact_email     text,
    channel           text not null default 'email',   -- 'email' | 'intake_form' | ...
    status            text not null default 'open',    -- 'open' | 'closed'
    last_message_at   timestamptz,
    created_at        timestamptz not null default now()
);

-- ── message ─────────────────────────────────────────────────────────────
-- Individual messages within a thread, either side.
create table message (
    id                uuid primary key default gen_random_uuid(),
    thread_id         uuid not null references thread(id) on delete cascade,
    user_id           uuid not null references auth.users(id) on delete cascade,
    direction         text not null,   -- 'inbound' | 'outbound'
    body              text not null,
    sent_at           timestamptz not null default now(),
    created_at        timestamptz not null default now()
);

-- ── deal ────────────────────────────────────────────────────────────────
-- The pipeline entity: what the agent extracts and scores from a thread.
create table deal (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    thread_id         uuid not null references thread(id) on delete cascade,
    intent            text,
    stage             text not null default 'new',   -- new|qualified|quoted|won|lost
    score             text,                            -- hot|warm|cold
    score_rationale   text,
    estimated_value   numeric,
    source            text,
    next_action       text,
    next_action_at    timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- ── indexes ─────────────────────────────────────────────────────────────
create index idx_thread_user            on thread (user_id);
create index idx_message_thread         on message (thread_id);
create index idx_message_user           on message (user_id);
create index idx_deal_user              on deal (user_id);
create index idx_deal_thread            on deal (thread_id);
create index idx_deal_next_action_at    on deal (next_action_at) where next_action_at is not null;

-- ── row level security ──────────────────────────────────────────────────
-- Every table scoped strictly to its owner (auth.uid()). No cross-user
-- reads are possible even via a leaked anon key.
alter table profile enable row level security;
alter table thread  enable row level security;
alter table message enable row level security;
alter table deal    enable row level security;

create policy "profile_owner" on profile
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "thread_owner" on thread
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "message_owner" on message
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "deal_owner" on deal
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Clockwork — migration 004: outbound sourcing
--
-- The `Source →` head of the spine. Until now the only way a lead could
-- enter the system was POST /intake (or the seed script); these two
-- tables are what let the agent go *find* work instead of waiting for it.
--
-- Sources are per-user rather than global: which feeds a given freelancer
-- pulls from is their choice, and keeping user_id on the row means the
-- same `auth.uid() = user_id` RLS pattern as every other table here,
-- with no special-casing.

create extension if not exists pgcrypto;

-- ── source ──────────────────────────────────────────────────────────────
-- One row per feed this freelancer pulls from.
create table source (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    kind              text not null,   -- 'hacker_news' | 'remotive' | 'remoteok' | ...
    name              text not null,
    config            jsonb default '{}',   -- adapter-specific (e.g. HN query terms)
    enabled           boolean not null default true,
    last_fetched_at   timestamptz,
    last_error        text,
    created_at        timestamptz not null default now(),
    unique (user_id, kind)
);

-- ── opportunity ─────────────────────────────────────────────────────────
-- A single sourced lead. `raw` caches the source's own payload verbatim so
-- a demo never depends on a live third party being up, and so re-scoring
-- never needs a refetch.
create table opportunity (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    source_id         uuid references source(id) on delete set null,

    -- Identity from the originating feed. Dedupe key: refetching the same
    -- HN thread must update rows, never pile up duplicates.
    external_id       text not null,
    title             text,
    body              text,
    url               text,
    author            text,
    posted_at         timestamptz,
    raw               jsonb default '{}',

    -- Fit, filled in by the score_fit tool. 0-100 rather than hot/warm/cold
    -- because these need *ranking* against each other, not bucketing --
    -- a feed dump is long and the top of the list is what matters.
    fit_score         integer,
    fit_rationale     text,
    fit_evidence      jsonb default '[]',   -- which profile facts actually matched

    status            text not null default 'new',
    -- new       -> fetched, not yet scored
    -- scored    -> has a fit score
    -- pitched   -> a pitch was drafted (approval queued)
    -- dismissed -> explicitly rejected by the human
    -- converted -> became a real deal

    deal_id           uuid references deal(id) on delete set null,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    unique (user_id, external_id)
);

-- ── indexes ─────────────────────────────────────────────────────────────
create index idx_source_user               on source (user_id);
create index idx_opportunity_user_status   on opportunity (user_id, status);
-- The Opportunities screen's default view: best fit first, nulls last.
create index idx_opportunity_user_fit      on opportunity (user_id, fit_score desc nulls last);

-- ── row level security ──────────────────────────────────────────────────
alter table source      enable row level security;
alter table opportunity enable row level security;

create policy "source_owner" on source
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "opportunity_owner" on opportunity
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Migration 003 granted service_role on everything that existed *then*;
-- these two tables are new, so they need it too (the ALTER DEFAULT
-- PRIVILEGES in 003 only covers tables created by the same role that ran
-- it -- don't rely on it, just grant explicitly).
grant all on table source to service_role;
grant all on table opportunity to service_role;

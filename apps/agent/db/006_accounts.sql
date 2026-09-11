-- Clockwork — migration 006: workspaces without sign-in
--
-- Magic-link auth is gone. It bought real security but cost the thing
-- this product is actually judged on: a stranger opening the link had to
-- find an email, click a token, and come back before seeing anything at
-- all. The front door is now the onboarding form -- name, email, skills,
-- rate, one portfolio result -- and filling it in *is* what creates the
-- workspace.
--
-- BE CLEAR ABOUT WHAT THIS COSTS: a workspace is now identified by an
-- unguessable id held in a cookie, and anyone holding that id can read
-- and write that workspace. There is no password, no session expiry and
-- no way to revoke it. That is an acceptable trade for a demo whose data
-- the user typed in thirty seconds ago; it is NOT acceptable for real
-- client correspondence, and the README says so in as many words.
--
-- What changes here:
--   1. `account` replaces auth.users as the thing user_id points at.
--   2. Every user_id foreign key is repointed from auth.users to it.
--   3. The auth.uid() RLS policies are dropped -- they can never match
--      now, so leaving them would be decoration. RLS stays ENABLED with
--      no policy, which is deny-all: the anon key grants nothing, and
--      the backend's service_role bypasses RLS as it always has. Access
--      control lives entirely in the API layer from here.
--   4. profile gains the fields onboarding collects.

create extension if not exists pgcrypto;

-- ── account ─────────────────────────────────────────────────────────────
-- One row per workspace. Deliberately thin: everything a human typed
-- lives on `profile`, so this table is only ever the identity anchor.
create table if not exists account (
    id           uuid primary key default gen_random_uuid(),
    created_at   timestamptz not null default now(),
    last_seen_at timestamptz not null default now()
);

-- ── repoint every user_id at account ────────────────────────────────────
-- Constraint names are Postgres defaults (<table>_<column>_fkey). Dropped
-- with `if exists` so re-running this migration is harmless.
do $$
declare
    t text;
begin
    foreach t in array array[
        'profile', 'thread', 'message', 'deal',
        'agent_run', 'agent_event', 'approval', 'task',
        'token_ledger', 'app_setting', 'source', 'opportunity',
        'quote', 'invoice'
    ]
    loop
        execute format(
            'alter table %I drop constraint if exists %I',
            t, t || '_user_id_fkey'
        );
    end loop;
end $$;

-- app_setting keys on user_id rather than having its own id, so its
-- constraint is named for the primary key column instead.
alter table app_setting drop constraint if exists app_setting_user_id_fkey;

-- Any workspace that already has data predates this migration; give it an
-- account row so the new foreign keys below can be added without failing.
insert into account (id)
select distinct user_id from profile
on conflict (id) do nothing;

insert into account (id)
select distinct user_id from thread
on conflict (id) do nothing;

do $$
declare
    t text;
begin
    foreach t in array array[
        'profile', 'thread', 'message', 'deal',
        'agent_run', 'agent_event', 'approval', 'task',
        'token_ledger', 'app_setting', 'source', 'opportunity',
        'quote', 'invoice'
    ]
    loop
        execute format(
            'alter table %I add constraint %I
               foreign key (user_id) references account(id) on delete cascade',
            t, t || '_user_id_fkey'
        );
    end loop;
end $$;

-- ── drop the auth.uid() policies ────────────────────────────────────────
-- These matched on a session that no longer exists. RLS stays on, with no
-- policy, which denies anon and authenticated outright.
drop policy if exists "profile_owner"      on profile;
drop policy if exists "thread_owner"       on thread;
drop policy if exists "message_owner"      on message;
drop policy if exists "deal_owner"         on deal;
drop policy if exists "agent_run_owner"    on agent_run;
drop policy if exists "agent_event_owner"  on agent_event;
drop policy if exists "approval_owner"     on approval;
drop policy if exists "task_owner"         on task;
drop policy if exists "token_ledger_owner" on token_ledger;
drop policy if exists "app_setting_owner"  on app_setting;
drop policy if exists "source_owner"       on source;
drop policy if exists "opportunity_owner"  on opportunity;
drop policy if exists "quote_owner"        on quote;
drop policy if exists "invoice_owner"      on invoice;

alter table account enable row level security;
grant all on table account to service_role;

-- ── what onboarding collects ────────────────────────────────────────────
-- email is contact data, not a credential: it is who the outbound work
-- comes from and where a reply would land. Nothing signs in with it.
alter table profile add column if not exists email text;
alter table profile add column if not exists timezone text;

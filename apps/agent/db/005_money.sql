-- Clockwork — migration 005: the money tail
--
-- Everything before this migration stops at "a conversation is going
-- well". That is the easy half. The half that actually decides whether
-- a freelancer gets paid is quote → invoice → chase, and it is the half
-- people avoid, because every step of it feels like asking for money.
--
-- Two tables, deliberately not one. A quote is a *proposal* -- it can be
-- declined, it expires, and its numbers are a negotiating position. An
-- invoice is a *claim* -- it has a number, a due date, and chasing it is
-- a different act with different tone. Collapsing them into one row
-- would mean either an invoice that can be declined or a quote with a
-- payment due date, and both are wrong.
--
-- Note what is NOT here: no payment provider, no card data, no Stripe
-- webhook. Marking an invoice paid is a human action through the API.
-- Taking money is not something this agent should be able to do, and
-- pretending to integrate a processor for a demo would be dishonest
-- about where the human stays in the loop.

create extension if not exists pgcrypto;

-- ── quote ───────────────────────────────────────────────────────────────
-- A priced proposal against one deal.
create table quote (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    deal_id           uuid not null references deal(id) on delete cascade,

    currency          text not null default 'USD',
    -- [{ description, quantity, unit, unit_price, amount }]
    -- `amount` and the totals below are computed in Python from the
    -- model's line items, never by the model itself -- see money.py.
    line_items        jsonb not null default '[]',
    subtotal          numeric not null default 0,
    total             numeric not null default 0,

    timeline          text,
    assumptions       jsonb default '[]',   -- what the price depends on
    exclusions        jsonb default '[]',   -- what it explicitly does not cover
    payment_terms     text,
    valid_until       timestamptz,

    status            text not null default 'draft',
    -- draft    -> written, approval queued, nothing sent
    -- sent     -> the human approved it and it went out
    -- accepted -> the client said yes (recorded by the human)
    -- declined -> the client said no
    -- expired  -> valid_until passed with no answer

    sent_at           timestamptz,
    decided_at        timestamptz,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- ── invoice ─────────────────────────────────────────────────────────────
-- A claim for payment. Usually born from an accepted quote, but
-- `quote_id` is nullable: work sometimes gets agreed in a conversation
-- and invoiced without a formal quote ever existing, and a schema that
-- forbids that would just push people back to their email client.
create table invoice (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users(id) on delete cascade,
    deal_id           uuid not null references deal(id) on delete cascade,
    quote_id          uuid references quote(id) on delete set null,

    number            text not null,   -- human-facing, e.g. INV-0007
    currency          text not null default 'USD',
    amount            numeric not null,
    line_items        jsonb not null default '[]',
    payment_terms     text,

    status            text not null default 'draft',
    -- draft -> written, approval queued
    -- sent  -> approved and issued
    -- paid  -> the human recorded payment
    -- void  -> cancelled

    issued_at         timestamptz,
    due_at            timestamptz,
    paid_at           timestamptz,

    -- How many reminders have already gone out. The chaser reads this to
    -- escalate tone rather than sending the same polite note forever --
    -- the fourth reminder being identical to the first is precisely why
    -- freelancers stop sending them.
    chase_count       integer not null default 0,
    last_chased_at    timestamptz,

    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),

    unique (user_id, number)
);

-- ── indexes ─────────────────────────────────────────────────────────────
create index idx_quote_user_status    on quote (user_id, status);
create index idx_quote_deal           on quote (deal_id);
create index idx_invoice_user_status  on invoice (user_id, status);
create index idx_invoice_deal         on invoice (deal_id);
-- Unpaid invoices past their due date: the query the chaser actually runs.
create index idx_invoice_due          on invoice (due_at) where status = 'sent';

-- ── row level security ──────────────────────────────────────────────────
alter table quote   enable row level security;
alter table invoice enable row level security;

create policy "quote_owner" on quote
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "invoice_owner" on invoice
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Same reasoning as 004: grant explicitly rather than trusting the
-- ALTER DEFAULT PRIVILEGES from 003 to have applied to these.
grant all on table quote   to service_role;
grant all on table invoice to service_role;

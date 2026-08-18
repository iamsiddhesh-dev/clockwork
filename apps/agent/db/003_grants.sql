-- Clockwork — migration 003: fix missing service_role grants
--
-- Tables created via raw SQL in the Supabase SQL editor don't
-- automatically pick up the grants Supabase's own tooling normally sets
-- up for anon/authenticated/service_role. service_role is what our
-- backend uses (bypasses RLS by role, not by grant -- it still needs
-- the grants to touch the tables at all). Run once; also covers any
-- table created from here on via ALTER DEFAULT PRIVILEGES.

grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;

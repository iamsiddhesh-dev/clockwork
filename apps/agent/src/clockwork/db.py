"""Supabase client, service-role (bypasses RLS -- the agent acts as the
account owner on their behalf; per-user scoping is enforced in application
code by always filtering/writing with the right user_id, never by relying
on RLS at this layer)."""

from functools import lru_cache

from supabase import Client, create_client

from .config import settings


@lru_cache(maxsize=1)
def get_client() -> Client:
    return create_client(settings.supabase_url, settings.supabase_service_role_key)

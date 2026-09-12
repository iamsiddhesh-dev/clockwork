"""Test bootstrap.

Placeholder credentials are set here, before anything under `clockwork`
is imported, for two reasons:

1. `config.py` builds its `Settings` at import time, so a module that
   merely wants to test arithmetic still needs the variables to exist.
2. Environment variables take precedence over `.env` in
   pydantic-settings, so these deliberately *shadow* the developer's real
   credentials. A test run therefore cannot reach the real database even
   by accident -- which matters, because the same machine that runs these
   tests is the one with a live Supabase project in `.env`.

Everything tested here is pure: arithmetic, parsing, classification. No
test opens a socket or a database connection, which is why the suite runs
in well under a second and needs no fixtures.
"""

import os

os.environ.setdefault("SUPABASE_URL", "https://tests.invalid")
os.environ.update(
    {
        "SUPABASE_URL": "https://tests.invalid",
        "SUPABASE_ANON_KEY": "test-anon-key",
        "SUPABASE_SERVICE_ROLE_KEY": "test-service-role-key",
        "GROQ_API_KEY": "test-groq-key",
    }
)

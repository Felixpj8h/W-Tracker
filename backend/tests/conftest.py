"""Automated tests never use a developer's real TypeSafe credentials."""
import os

import pytest

# The API defaults to production. Tests use development unless a test opts
# into production settings itself.
os.environ.setdefault("APP_ENV", "development")


@pytest.fixture(autouse=True)
def no_live_typesafe(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

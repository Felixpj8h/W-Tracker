"""Automated tests never use a developer's real TypeSafe credentials."""
import pytest


@pytest.fixture(autouse=True)
def no_live_typesafe(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

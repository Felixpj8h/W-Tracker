"""Google Health contracts and account isolation, with no live provider access."""
from datetime import date, timedelta
import json
import time
from urllib.parse import parse_qs, urlsplit

from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app import main as m, health as h


@pytest.fixture
def health_client(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'health.db'}", connect_args={"check_same_thread": False})
    m.Base.metadata.create_all(engine)
    monkeypatch.setattr(m, "SessionLocal", sessionmaker(engine, autoflush=False))
    monkeypatch.setattr(m, "APP_ENV", "production")
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://tracker.test")
    monkeypatch.setattr(m, "configured_origins", ["https://tracker.test"])
    monkeypatch.setattr(m.app.state, "disable_auth", False, raising=False)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "signin-client")
    monkeypatch.setenv("ALLOWED_EMAILS", "a@example.test,b@example.test")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_ID", "health-client")
    monkeypatch.setenv("GOOGLE_HEALTH_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("GOOGLE_HEALTH_REDIRECT_URI", "https://tracker.test/api/v1/health/google/callback")
    monkeypatch.setenv("GOOGLE_HEALTH_TOKEN_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(m.id_token, "verify_oauth2_token", lambda token, *args: {"email": f"{token}@example.test", "email_verified": True})
    m.RATE_LIMIT_BUCKETS.clear()
    client = TestClient(m.app, base_url="https://tracker.test", headers={"Origin": "https://tracker.test", "Authorization": "Bearer a"})
    yield client
    client.close()
    engine.dispose()


def save_connection(owner="a@example.test", scopes=None, **kwargs):
    with m.SessionLocal(info={"owner_email": owner}) as db:
        item = m.HealthConnection(account_email=owner, tokens=h.pack({"refresh_token": "private-refresh", "access_token": "private-access", "expires_at": time.time() + 3600}), scopes=" ".join(scopes or h.SCOPES.values()), **kwargs)
        db.add(item)
        db.commit()


def start(client):
    response = client.post('/api/v1/health/google/connect')
    assert response.status_code == 200
    query = parse_qs(urlsplit(response.json()['url']).query)
    assert query['code_challenge_method'] == ['S256']
    assert 'writeonly' not in query['scope'][0]
    assert 'httponly' in response.headers['set-cookie'].lower()
    assert 'secure' in response.headers['set-cookie'].lower()
    return query['state'][0]


def test_private_health_and_missing_configuration(health_client, monkeypatch):
    c = health_client
    c.headers.pop('Authorization')
    assert c.get('/api/v1/health/overview').status_code == 401
    c.headers['Authorization'] = 'Bearer a'
    monkeypatch.delenv('GOOGLE_HEALTH_TOKEN_KEY')
    assert c.get('/api/v1/health/overview').json()['configured'] is False
    assert c.post('/api/v1/health/google/connect').status_code == 503


def test_account_isolation_and_no_token_leak(health_client):
    save_connection(snapshot=json.dumps({"days": [{"date": "2026-11-17", "steps": 4321}]}))
    a = health_client.get('/api/v1/health/overview')
    assert a.json()['data']['days'][0]['steps'] == 4321
    assert 'private-' not in a.text
    with m.SessionLocal() as db:
        assert 'private-refresh' not in db.scalar(select(m.HealthConnection)).tokens
    health_client.headers['Authorization'] = 'Bearer b'
    assert health_client.get('/api/v1/health/overview').json()['connected'] is False
    assert health_client.patch('/api/v1/health/goal', json={"step_goal": 12000}).status_code == 409
    health_client.delete('/api/v1/health/google')
    health_client.headers['Authorization'] = 'Bearer a'
    assert health_client.get('/api/v1/health/overview').json()['connected'] is True


def test_oauth_requires_browser_nonce_and_is_single_use(health_client, monkeypatch):
    state = start(health_client)
    cookie = health_client.cookies.get(h.COOKIE)
    health_client.cookies.clear()
    url = f'/api/v1/health/google/callback?state={state}&code=one-time-code'
    assert health_client.get(url, follow_redirects=False).status_code == 400
    health_client.cookies.set(h.COOKIE, cookie, domain='tracker.test', path=h.CALLBACK_PATH)
    monkeypatch.setattr(h, 'provider_request', lambda client, method, url, **kwargs: {
        "access_token": "private-access", "refresh_token": "private-refresh", "id_token": "a",
        "scope": h.SCOPES['sleep'], "expires_in": 3600} if url.endswith('/token') else {"healthUserId": "1"})
    response = health_client.get(url, follow_redirects=False)
    assert response.status_code == 303
    assert response.headers['location'] == 'https://tracker.test/?health=connected#health'
    result = health_client.get('/api/v1/health/overview').json()
    assert result['permissions'] == {"activity": False, "sleep": True, "recovery": False}
    assert health_client.get(url, follow_redirects=False).status_code == 400


def test_wrong_account_and_expired_state_rejected(health_client, monkeypatch):
    state = start(health_client)
    monkeypatch.setattr(h, 'provider_request', lambda *args, **kwargs: {"access_token": "token", "id_token": "b"})
    response = health_client.get(f'/api/v1/health/google/callback?state={state}&code=x', follow_redirects=False)
    assert 'health=failed' in response.headers['location']
    assert health_client.get('/api/v1/health/overview').json()['connected'] is False
    state = start(health_client)
    with m.SessionLocal() as db:
        db.scalar(select(m.HealthOAuthAttempt)).expires = 0
        db.commit()
    assert health_client.get(f'/api/v1/health/google/callback?state={state}&code=x').status_code == 400


def test_cross_site_connect_and_bad_goal_rejected(health_client):
    # A browser session must still pass the app's existing origin check.
    health_client.get('/api/v1/session')
    health_client.headers.pop('Authorization')
    assert health_client.post('/api/v1/health/google/connect', headers={"Origin": "https://other.test"}).status_code == 403
    health_client.headers['Authorization'] = 'Bearer a'
    save_connection()
    assert health_client.patch('/api/v1/health/goal', json={"step_goal": 999}).status_code == 422
    assert health_client.patch('/api/v1/health/goal', json={"step_goal": 10000}).json()['step_goal'] == 10000


def test_provider_pagination_rollups_sleep_dates_and_partial_failure(monkeypatch):
    today = date(2026, 11, 17)
    requests = []
    def handler(request):
        requests.append(request)
        assert request.headers['Authorization'] == 'Bearer synthetic'
        path = request.url.path
        if '/steps/' in path:
            body = json.loads(request.content)
            assert body['range']['start']['date']['day'] == 11
            assert body['windowSizeDays'] == 1
            return httpx.Response(200, json={"rollupDataPoints": [{"civilStartTime": {"date": {"year": 2026, "month": 11, "day": 17}}, "steps": {"countSum": "0"}}]})
        if '/active-minutes/' in path:
            return httpx.Response(403, json={})
        if '/sleep/' in path:
            if request.url.params.get('pageToken') == 'next':
                return httpx.Response(200, json={"dataPoints": [{"sleep": {"interval": {"startTime": "2026-11-16T22:00:00Z", "endTime": "2026-11-17T06:00:00Z", "endUtcOffset": "3600s"}, "summary": {"minutesAsleep": "450"}, "metadata": {"mainSleep": True}, "stages": []}}]})
            assert 'civil_end_time' in request.url.params['filter']
            return httpx.Response(200, json={"dataPoints": [], "nextPageToken": "next"})
        return httpx.Response(200, json={"dataPoints": []})
    real_client = httpx.Client
    monkeypatch.setattr(h.httpx, 'Client', lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs))
    data = h.fetch_data('synthetic', set(h.SCOPES.values()), today)
    assert len(data['days']) == 7
    assert data['days'][-1]['steps'] == 0  # Measured zero is preserved.
    assert data['days'][-2]['steps'] is None
    assert data['days'][-1]['sleep_minutes'] == 450
    assert data['sleep']['date'] == '2026-11-17'
    assert data['sleep']['stages'] == []
    assert list(data['warnings']) == ['active_minutes']
    assert len([v for v in requests if '/sleep/' in v.url.path]) == 2


def test_principal_sleep_not_nap_and_local_wake_day():
    interval = {"startTime": "2026-11-16T16:00:00Z", "endTime": "2026-11-16T23:30:00Z", "endUtcOffset": "7200s"}
    data = h.normalize({"sleep": [
        {"sleep": {"interval": interval, "summary": {"minutesAsleep": "420"}, "metadata": {"mainSleep": True}}},
        {"sleep": {"interval": interval, "summary": {"minutesAsleep": "30"}}},
    ]}, date(2026, 11, 17))
    assert data['days'][-1]['sleep_minutes'] == 420
    assert data['sleep']['date'] == '2026-11-17'


def test_refresh_and_complete_failure_preserve_cache(health_client, monkeypatch):
    save_connection(snapshot=json.dumps({"days": []}), fetched_at=100)
    with m.SessionLocal() as db:
        db.scalar(select(m.HealthConnection)).tokens = h.pack({"access_token": "expired", "refresh_token": "refresh", "expires_at": 0})
        db.commit()
    calls = []
    def refresh(client, method, url, **kwargs):
        calls.append(kwargs['data'])
        return {"access_token": "renewed", "expires_in": 3600}
    monkeypatch.setattr(h, 'provider_request', refresh)
    monkeypatch.setattr(h, 'fetch_data', lambda *args: {"warnings": {key: "Provider unavailable" for key in ('steps', 'active_minutes', 'sleep', 'workouts', 'hrv', 'resting_hr')}})
    result = health_client.post('/api/v1/health/sync', json={"today": date.today().isoformat()})
    assert result.status_code == 502
    assert calls[0]['grant_type'] == 'refresh_token'
    assert health_client.get('/api/v1/health/overview').json()['fetched_at'] == 100
    with m.SessionLocal() as db:
        tokens = h.unpack(db.scalar(select(m.HealthConnection)))
        assert tokens['access_token'] == 'renewed'
        assert tokens['refresh_token'] == 'refresh'


def test_disconnect_deletes_even_with_lost_key(health_client, monkeypatch):
    save_connection()
    start(health_client)
    monkeypatch.setenv('GOOGLE_HEALTH_TOKEN_KEY', Fernet.generate_key().decode())
    assert health_client.delete('/api/v1/health/google').json()['saved'] is True
    with m.SessionLocal() as db:
        assert db.scalar(select(m.HealthConnection)) is None
        assert db.scalar(select(m.HealthOAuthAttempt)) is None


def test_future_date_rejected(health_client):
    assert health_client.post('/api/v1/health/sync', json={"today": (date.today() + timedelta(days=3)).isoformat()}).status_code == 400

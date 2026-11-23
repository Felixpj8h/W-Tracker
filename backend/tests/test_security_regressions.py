import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app import main as m
from app.database_security import install_folder_guards


@pytest.fixture
def secure_app(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'security.db'}", connect_args={"check_same_thread": False})
    m.Base.metadata.create_all(engine)
    with engine.begin() as connection:
        install_folder_guards(connection)
    monkeypatch.setattr(m, "engine", engine)
    monkeypatch.setattr(m, "SessionLocal", sessionmaker(engine, autoflush=False))
    monkeypatch.setattr(m, "APP_ENV", "production")
    monkeypatch.setattr(m, "configured_origins", ["https://tracker.test"])
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://tracker.test")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setenv("ALLOWED_EMAILS", "a@example.test,b@example.test")
    monkeypatch.setattr(m.app.state, "disable_auth", False, raising=False)
    monkeypatch.setattr(m.app.state, "disable_catalogue_refresh", True, raising=False)
    monkeypatch.setattr(m.id_token, "verify_oauth2_token", lambda token, *_: {
        "email": f"{token}@example.test", "email_verified": True})
    m.RATE_LIMIT_BUCKETS.clear()
    with TestClient(m.app, base_url="https://tracker.test", headers={"Origin": "https://tracker.test"}) as client:
        assert client.get("/api/v1/session", headers={"Authorization": "Bearer a"}).status_code == 200
        yield client, engine
    engine.dispose()


def test_logout_revokes_copied_cookie_and_host_cannot_authorize_origin(secure_app):
    client, engine = secure_app
    token = client.cookies.get(m.SESSION_COOKIE)
    assert "secure" in client.get("/api/v1/session", headers={"Authorization": "Bearer a"}).headers["set-cookie"].lower()
    # Use the current cookie for the replay assertion.
    token = client.cookies.get(m.SESSION_COOKIE)
    assert client.post("/api/v1/folders", json={"name": "forged"}, headers={
        "Host": "attacker.test", "Origin": "https://attacker.test"}).status_code == 403
    assert client.post("/api/v1/session/logout").status_code == 200
    assert client.get("/api/v1/session", headers={"Cookie": f"{m.SESSION_COOKIE}={token}"}).status_code == 401
    with Session(engine) as db:
        row = db.get(m.BrowserSession, hashlib.sha256(token.encode()).hexdigest())
        assert row.revoked and token not in row.identity


@pytest.mark.parametrize("local", [False, True], ids=["browser-session", "localhost"])
def test_calendar_move_after_session_read_burst(secure_app, monkeypatch, local):
    client, _ = secure_app
    if local:
        monkeypatch.setattr(m, "APP_ENV", "development")
        client = TestClient(m.app, base_url="http://localhost:8000", client=("127.0.0.1", 50000))

    source, target = "2026-11-17", "2026-11-18"
    created = client.post("/api/v1/workouts", json={"name": "Upper", "performed_on": source, "exercises": []})
    assert created.status_code == 200
    for _ in range(61):
        assert client.get("/api/v1/session").status_code == 200

    moved = client.post("/api/v1/calendar/move", json={"source": source, "target": target})
    assert moved.status_code == 200
    workouts = client.get("/api/v1/workouts").json()
    assert next(workout for workout in workouts if workout["id"] == created.json()["id"])["performed_on"] == target


def test_sign_in_throttle_blocks_token_verification_and_keeps_sessions_working(secure_app, monkeypatch):
    client, _ = secure_app
    anonymous = TestClient(m.app, base_url="https://tracker.test")
    for _ in range(59):  # The fixture already used one sign-in attempt from the same IP.
        assert anonymous.get("/api/v1/session").status_code == 401

    def unexpected_verification(*_args):
        pytest.fail("Rate-limited sign-ins should stop before Google token verification")

    monkeypatch.setattr(m.id_token, "verify_oauth2_token", unexpected_verification)
    limited = anonymous.get("/api/v1/session", headers={"Authorization": "Bearer a"})
    assert limited.status_code == 429
    assert int(limited.headers["Retry-After"]) > 0
    assert client.get("/api/v1/session").status_code == 200


def test_workout_revision_and_completion_boundary(secure_app):
    client, _ = secure_app
    draft = client.post("/api/v1/workouts/draft", json={"name": "Draft"}).json()
    path = f"/api/v1/workouts/{draft['id']}"
    payload = {**draft, "exercises": [{"name": "Bench", "sets": [{"weight": 50, "reps": 9}]}]}
    assert client.patch(path, json={**payload, "revision": None}).status_code == 409
    saved = client.patch(path, json=payload).json()
    assert saved["revision"] == draft["revision"] + 1
    assert client.patch(path, json=payload).status_code == 409
    finished = client.put(path, json={**payload, "revision": saved["revision"]}).json()
    assert finished["completed"]
    assert client.patch(path, json={**payload, "revision": finished["revision"]}).status_code == 409
    edited = client.patch(path, json={**finished, "intent": "edit", "note": "Intentional edit"})
    assert edited.status_code == 200
    assert edited.json()["exercises"][0]["sets"][0]["reps"] == 9


def test_workout_save_with_lost_response_can_be_retried_by_the_same_device(secure_app):
    client, _ = secure_app
    phone, laptop = "a" * 32, "b" * 32
    draft = client.post("/api/v1/workouts/draft", json={"name": "Draft"}).json()
    path = f"/api/v1/workouts/{draft['id']}"
    payload = {**draft, "writer_id": phone, "exercises": [{"name": "Bench", "sets": [{"weight": 50, "reps": 9}]}]}
    # The server applied this save, but Android closed the app before the
    # phone read the response, so the phone still holds the first revision.
    assert client.patch(path, json=payload).json()["revision"] == draft["revision"] + 1
    retried = client.patch(path, json={**payload, "name": "Kept"})
    assert retried.status_code == 200
    assert retried.json()["name"] == "Kept"
    assert retried.json()["revision"] == draft["revision"] + 2
    assert client.get(path).json() == {key: value for key, value in retried.json().items() if key != "saved"}
    # Another device with an older revision must still reload first.
    assert client.patch(path, json={**payload, "writer_id": laptop, "name": "Overwrite"}).status_code == 409
    assert client.get(path).json()["name"] == "Kept"
    # Once another device saves, the phone's older revision is stale again.
    laptop_save = client.patch(path, json={**payload, "writer_id": laptop, "revision": retried.json()["revision"], "name": "Laptop"}).json()
    assert client.patch(path, json={**payload, "name": "Phone"}).status_code == 409
    assert client.patch(path, json={**payload, "revision": laptop_save["revision"], "name": "Phone"}).status_code == 200
    # A save that names no device makes the latest revision required again.
    unnamed = client.patch(path, json={key: value for key, value in {**payload, "revision": laptop_save["revision"] + 1}.items() if key != "writer_id"}).json()
    assert client.patch(path, json={**payload, "name": "Stale"}).status_code == 409
    finished = client.put(path, json={**payload, "revision": unnamed["revision"]}).json()
    assert finished["completed"]
    # The device bypass never reopens a finished session as a draft.
    assert client.patch(path, json=payload).status_code == 409
    # Moving the workout in the calendar is a change the phone has not seen.
    assert client.post("/api/v1/calendar/move", json={"source": finished["performed_on"], "target": "2030-01-02"}).status_code == 200
    assert client.patch(path, json={**payload, "intent": "edit", "revision": finished["revision"]}).status_code == 409
    assert client.get(path).json()["performed_on"] == "2030-01-02"
    assert client.patch(path, json={**payload, "writer_id": "not valid!"}).status_code == 422
    assert client.get("/api/v1/workouts/999999").status_code == 404
    assert client.get(path, headers={"Authorization": "Bearer b"}).status_code == 404


def test_session_expiry_allowlist_and_missing_origins(secure_app, monkeypatch):
    client, engine = secure_app
    token = client.cookies.get(m.SESSION_COOKIE)
    for origin in ("null", "https://attacker.test", "https://tracker.test.attacker.test"):
        assert client.post("/api/v1/folders", json={"name": "Rejected"}, headers={"Origin": origin}).status_code == 403
    client.headers.pop("Origin")
    assert client.post("/api/v1/folders", json={"name": "Rejected"}).status_code == 403
    monkeypatch.setenv("ALLOWED_EMAILS", "b@example.test")
    assert client.get("/api/v1/session").status_code == 401
    monkeypatch.setenv("ALLOWED_EMAILS", "a@example.test,b@example.test")
    engine.dispose()
    assert client.get("/api/v1/session").status_code == 200
    with Session(engine) as db:
        db.get(m.BrowserSession, hashlib.sha256(token.encode()).hexdigest()).expires = 0
        db.commit()
    assert client.get("/api/v1/session").status_code == 401


def test_concurrent_workout_saves_detect_conflict(secure_app):
    client, engine = secure_app
    draft = client.post("/api/v1/workouts/draft", json={"name": "Concurrent"}).json()
    barrier = Barrier(2)
    def synchronize(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE workouts SET revision="):
            barrier.wait(timeout=10)
    event.listen(engine, "before_cursor_execute", synchronize)
    def save(name):
        with TestClient(m.app, base_url="https://tracker.test") as browser:
            return browser.patch(f"/api/v1/workouts/{draft['id']}", json={**draft, "name": name},
                headers={"Authorization": "Bearer a"}).status_code
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            assert sorted(pool.map(save, ("First", "Second"))) == [200, 409]
    finally:
        event.remove(engine, "before_cursor_execute", synchronize)


def test_folder_ownership_is_enforced_in_api_and_database(secure_app):
    client, engine = secure_app
    a = client.post("/api/v1/folders", json={"name": "A"}).json()["id"]
    routine = client.post("/api/v1/routines", json={"name": "A", "folder_id": a, "exercises": []}).json()["id"]
    b = client.post("/api/v1/folders", json={"name": "B"}, headers={"Authorization": "Bearer b"}).json()["id"]
    assert client.put(f"/api/v1/routines/{routine}", json={"name": "Moved", "folder_id": b, "exercises": []}).status_code == 404
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.exec_driver_sql("UPDATE routines SET folder_id=? WHERE id=?", (b, routine))
    with Session(engine) as db:
        assert db.get(m.Routine, routine).folder_id == a


@pytest.mark.parametrize("actions", [("confirm", "confirm"), ("confirm", "reject")])
def test_proposal_resolution_is_atomic(secure_app, actions):
    _, engine = secure_app
    with Session(engine) as db:
        conversation = m.AIConversation(owner_email="a@example.test", title="Test")
        db.add(conversation); db.flush()
        proposal = m.AIChangeProposal(conversation_id=conversation.id, operation="create_routine",
            payload=json.dumps({"name": "Once", "exercises": []}), summary="Once")
        db.add(proposal); db.commit(); identity = proposal.id
    barrier = Barrier(2)
    def synchronize(connection, cursor, statement, parameters, context, executemany):
        if statement.startswith("UPDATE ai_change_proposals") and "status =" in statement:
            barrier.wait(timeout=10)
    event.listen(engine, "before_cursor_execute", synchronize)
    def resolve(action):
        with TestClient(m.app, base_url="https://tracker.test") as browser:
            return browser.post(f"/api/v1/ai/proposals/{identity}/{action}", headers={"Authorization": "Bearer a"}).status_code
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(resolve, actions))
    finally:
        event.remove(engine, "before_cursor_execute", synchronize)
    assert all(code in (200, 409) for code in statuses)
    with Session(engine) as db:
        state = db.get(m.AIChangeProposal, identity).status
        count = db.scalar(select(func.count()).select_from(m.Routine))
        assert count == (1 if state == "applied" else 0)
        assert state in ("applied", "rejected")

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from threading import Barrier

import pytest
from fastapi.routing import APIRoute
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


@pytest.mark.parametrize(("value", "expected"), [(None, "production"), ("", "production"), (" Development ", "development"), ("production", "production"), ("prod", None), ("staging", None)])
def test_app_env_fails_closed(tmp_path, value, expected):
    environment = {key: item for key, item in os.environ.items() if key not in {"APP_ENV", "ENABLE_API_DOCS"}}
    environment.update({"PYTHON_DOTENV_DISABLED": "1", "DATABASE_URL": f"sqlite:///{tmp_path / 'env.db'}"})
    if value is not None:
        environment["APP_ENV"] = value
    result = subprocess.run([sys.executable, "-c", "from app import main; print(main.APP_ENV, main.DOCS_ENABLED)"],
        cwd=Path(__file__).resolve().parents[1], env=environment, capture_output=True, text=True, timeout=120)
    if expected is None:
        assert result.returncode != 0
        assert "APP_ENV must be 'development' or 'production'" in result.stderr
    else:
        assert result.returncode == 0, result.stderr
        assert result.stdout.split()[-2:] == [expected, str(expected == "development")]


def _signed_in_client(account: str) -> TestClient:
    client = TestClient(m.app, base_url="https://tracker.test", headers={"Origin": "https://tracker.test"})
    assert client.get("/api/v1/session", headers={"Authorization": f"Bearer {account}"}).status_code == 200
    return client


def _account_a_with_data(a: TestClient, engine) -> dict:
    """Give account A one of everything an ID-based route can reach."""
    with Session(engine) as db:
        exercise = m.Exercise(wger_id="isolation-bench", name="Isolation Bench Press", equipment="Barbell", primary_muscle="Chest", muscle_group="Chest")
        db.add(exercise); db.commit(); exercise_id = exercise.id
    custom = a.post("/api/v1/exercises/custom", json={"name": "A secret exercise", "primary_muscle": "Chest"}).json()["id"]
    folder = a.post("/api/v1/folders", json={"name": "A folder"}).json()["id"]
    choice = {"exercise_id": exercise_id, "planned_sets": 3, "target_reps": 8}
    custom_choice = {"exercise_id": custom, "planned_sets": 2, "target_reps": 12}
    routine = a.post("/api/v1/routines", json={"name": "A routine", "folder_id": folder, "exercises": [choice, custom_choice]}).json()["id"]
    draft = a.post(f"/api/v1/routines/{routine}/start").json()
    completed = a.post("/api/v1/workouts", json={"name": "A finished", "performed_on": "2026-03-10", "exercises": [{"exercise_id": exercise_id, "sets": [{"weight": 60, "reps": 8}]}]}).json()
    label = a.post("/api/v1/calendar/labels", json={"name": "A label", "color": "rose"}).json()["id"]
    for response in (
        a.put("/api/v1/calendar/2026-03-11/label", json={"label_id": label}),
        a.put(f"/api/v1/calendar/2026-03-12/routine/{routine}", json={"name": "A planned", "folder_id": folder, "exercises": [choice]}),
        a.post("/api/v1/calendar/plan", json={"name": "A plan", "starts_on": "2026-03-02", "days": [{"weekday": 0, "routine_id": routine}]}),
        a.post("/api/v1/bodyweight", json={"recorded_on": "2026-03-10", "weight": 80.5}),
        a.put("/api/v1/settings", json={"ai_output_length": "brief"}),
    ):
        assert response.status_code == 200, response.text
    conversation = a.post("/api/v1/ai/conversations", json={"title": "A chat"}).json()["id"]
    with Session(engine) as db:
        proposal = m.AIChangeProposal(conversation_id=conversation, operation="create_routine",
                                      payload=json.dumps({"name": "A proposal", "exercises": []}), summary="A proposal")
        db.add(proposal); db.commit(); proposal_id = proposal.id
    return {"exercise": exercise_id, "custom": custom, "folder": folder, "routine": routine, "draft": draft, "completed": completed,
            "label": label, "conversation": conversation, "proposal": proposal_id}


def _account_view(client: TestClient, ids: dict) -> dict:
    """Everything an account can read about its own data, for a before/after comparison."""
    paths = ["/api/v1/folders", "/api/v1/workouts", "/api/v1/workouts/active", "/api/v1/calendar/labels", "/api/v1/calendar/plan",
             "/api/v1/calendar?year=2026&month=3", "/api/v1/bodyweight", "/api/v1/settings", "/api/v1/ai/conversations",
             f"/api/v1/ai/conversations/{ids['conversation']}", f"/api/v1/workouts/{ids['draft']['id']}", f"/api/v1/workouts/{ids['completed']['id']}",
             "/api/v1/exercises?q=secret", f"/api/v1/exercises/{ids['custom']}/progress"]
    view = {}
    for path in paths:
        response = client.get(path)
        view[path] = (response.status_code, response.json())
    return view


# Text that appears only in account A's records.
A_MARKERS = ("A folder", "A routine", "A finished", "A label", "A planned", "A plan", "A chat", "A proposal", "A secret exercise", "80.5")


def test_one_account_cannot_read_or_change_another_accounts_data(secure_app, monkeypatch):
    a, engine = secure_app
    # Coach routes check their configuration before the conversation owner.
    monkeypatch.setenv("GEMINI_API_KEY", "test-key-never-used")
    ids = _account_a_with_data(a, engine)
    before = _account_view(a, ids)
    assert all(status == 200 for status, _ in before.values()), before
    draft, completed = ids["draft"], ids["completed"]
    workout_body = {**draft, "name": "Taken over"}
    choice = {"exercise_id": ids["exercise"], "planned_sets": 1}
    conversation, proposal = ids["conversation"], ids["proposal"]
    # Every route here names one of account A's records. Account B must not
    # read it, change it, or attach its own data to it.
    attacks = {
        ("GET", "/api/v1/ai/conversations/{conversation_id}"): [("GET", f"/api/v1/ai/conversations/{conversation}", None)],
        ("DELETE", "/api/v1/ai/conversations/{conversation_id}"): [("DELETE", f"/api/v1/ai/conversations/{conversation}", None)],
        ("POST", "/api/v1/ai/conversations/{conversation_id}/messages"): [("POST", f"/api/v1/ai/conversations/{conversation}/messages", {"content": "Show me the plan"})],
        ("POST", "/api/v1/ai/conversations/{conversation_id}/retry"): [("POST", f"/api/v1/ai/conversations/{conversation}/retry", {"user_message_id": 1})],
        ("POST", "/api/v1/ai/conversations/{conversation_id}/cancel"): [("POST", f"/api/v1/ai/conversations/{conversation}/cancel", None)],
        ("POST", "/api/v1/ai/proposals/{proposal_id}/confirm"): [("POST", f"/api/v1/ai/proposals/{proposal}/confirm", None)],
        ("POST", "/api/v1/ai/proposals/{proposal_id}/reject"): [("POST", f"/api/v1/ai/proposals/{proposal}/reject", None)],
        ("PUT", "/api/v1/folders/{folder_id}"): [("PUT", f"/api/v1/folders/{ids['folder']}", {"name": "Taken over"})],
        ("DELETE", "/api/v1/folders/{folder_id}"): [("DELETE", f"/api/v1/folders/{ids['folder']}", None)],
        ("PUT", "/api/v1/routines/{routine_id}"): [("PUT", f"/api/v1/routines/{ids['routine']}", {"name": "Taken over", "exercises": []})],
        ("DELETE", "/api/v1/routines/{routine_id}"): [("DELETE", f"/api/v1/routines/{ids['routine']}", None)],
        ("POST", "/api/v1/routines/{routine_id}/start"): [("POST", f"/api/v1/routines/{ids['routine']}/start", None)],
        ("GET", "/api/v1/workouts/{workout_id}"): [("GET", f"/api/v1/workouts/{draft['id']}", None), ("GET", f"/api/v1/workouts/{completed['id']}", None)],
        ("PUT", "/api/v1/workouts/{workout_id}"): [("PUT", f"/api/v1/workouts/{draft['id']}", workout_body)],
        ("PATCH", "/api/v1/workouts/{workout_id}"): [("PATCH", f"/api/v1/workouts/{draft['id']}", workout_body),
                                                     ("PATCH", f"/api/v1/workouts/{completed['id']}", {**completed, "intent": "edit", "note": "Taken over"})],
        ("DELETE", "/api/v1/workouts/{workout_id}"): [("DELETE", f"/api/v1/workouts/{draft['id']}", None), ("DELETE", f"/api/v1/workouts/{completed['id']}", None)],
        ("GET", "/api/v1/workouts/{workout_id}/exercise-progress"): [("GET", f"/api/v1/workouts/{completed['id']}/exercise-progress", None)],
        ("PATCH", "/api/v1/calendar/labels/{label_id}"): [("PATCH", f"/api/v1/calendar/labels/{ids['label']}", {"name": "Taken over", "color": "slate"})],
        ("DELETE", "/api/v1/calendar/labels/{label_id}"): [("DELETE", f"/api/v1/calendar/labels/{ids['label']}", None)],
        ("PUT", "/api/v1/calendar/{day}/label"): [("PUT", "/api/v1/calendar/2026-03-13/label", {"label_id": ids["label"]})],
        ("DELETE", "/api/v1/calendar/{day}/label"): [("DELETE", "/api/v1/calendar/2026-03-11/label", None)],
        ("DELETE", "/api/v1/calendar/{day}"): [("DELETE", "/api/v1/calendar/2026-03-12", None), ("DELETE", "/api/v1/calendar/2026-03-10", None)],
        ("PUT", "/api/v1/calendar/{day}/routine/{routine_id}"): [("PUT", f"/api/v1/calendar/2026-03-14/routine/{ids['routine']}", {"name": "B planned", "exercises": [choice]})],
        ("GET", "/api/v1/exercises/{exercise_id}/progress"): [("GET", f"/api/v1/exercises/{ids['exercise']}/progress", None),
                                                              ("GET", f"/api/v1/exercises/{ids['custom']}/progress", None)],
        ("DELETE", "/api/v1/exercises/custom/{exercise_id}"): [("DELETE", f"/api/v1/exercises/custom/{ids['custom']}", None),
                                                               ("DELETE", f"/api/v1/exercises/custom/{ids['exercise']}", None)],
    }
    # Routes that name another account's records in the request body or by date.
    body_references = [
        ("POST", "/api/v1/routines", {"name": "B routine", "folder_id": ids["folder"], "exercises": []}),
        ("POST", "/api/v1/calendar/plan", {"name": "B plan", "starts_on": "2026-03-02", "days": [{"weekday": 1, "routine_id": ids["routine"]}]}),
        ("POST", "/api/v1/calendar/move", {"source": "2026-03-10", "target": "2026-03-20"}),
        ("POST", "/api/v1/routines", {"name": "B routine", "exercises": [{"exercise_id": ids["custom"], "planned_sets": 1}]}),
        ("POST", "/api/v1/workouts", {"name": "B workout", "performed_on": "2026-03-15", "exercises": [{"exercise_id": ids["custom"], "sets": []}]}),
        ("POST", "/api/v1/exercises/custom", {"name": "Isolation Bench Press", "primary_muscle": "Legs"}),
    ]
    # A new route with an ID or date in its path must be added to the attacks above.
    id_routes = {(method, route.path) for route in m.app.routes
                 if isinstance(route, APIRoute) and "{" in route.path and route.path.startswith("/api/v1/")
                 and not route.path.startswith(("/api/v1/demo", "/api/v1/health")) for method in route.methods}
    assert id_routes == set(attacks), f"Add cross-account checks for: {sorted(id_routes ^ set(attacks))}"
    with _signed_in_client("b") as b:
        for method, path, body in [request for requests in attacks.values() for request in requests] + body_references:
            response = b.request(method, path, json=body)
            assert response.status_code < 500, (method, path, response.text)
            if method == "GET" and not path.endswith(f"/exercises/{ids['exercise']}/progress"):
                assert response.status_code == 404, (method, path, response.text)
            assert not any(marker in response.text for marker in A_MARKERS), (method, path, response.text)
        # Account B sees none of account A's records anywhere it can list them.
        for path in ("/api/v1/folders", "/api/v1/workouts", "/api/v1/workouts/active", "/api/v1/calendar/labels", "/api/v1/calendar/plan",
                     "/api/v1/calendar?year=2026&month=3", "/api/v1/bodyweight", "/api/v1/ai/conversations", "/api/v1/dashboard",
                     f"/api/v1/exercises/{ids['exercise']}/progress"):
            response = b.get(path)
            assert response.status_code == 200, (path, response.text)
            assert not any(marker in response.text for marker in A_MARKERS), (path, response.text)
        assert b.get("/api/v1/settings").json()["ai_output_length"] == "normal"
    assert _account_view(a, ids) == before



def test_custom_exercises_stay_private_to_their_account(secure_app):
    a, engine = secure_app
    with Session(engine) as db:
        catalogue = m.Exercise(wger_id="isolation-squat", name="Isolation Squat", equipment="Barbell", primary_muscle="Quadriceps", muscle_group="Legs")
        db.add(catalogue); db.commit(); catalogue_id = catalogue.id
    custom = a.post("/api/v1/exercises/custom", json={"name": "A secret exercise", "primary_muscle": "Chest"}).json()
    assert custom["name"] == "A secret exercise"
    # Creating it again returns the same row and may update its muscle.
    again = a.post("/api/v1/exercises/custom", json={"name": "a secret EXERCISE", "primary_muscle": "Back"}).json()
    assert again["id"] == custom["id"] and again["muscle_group"] == "Back"
    # A shared catalogue name returns the catalogue exercise unchanged.
    shared = a.post("/api/v1/exercises/custom", json={"name": "isolation squat", "primary_muscle": "Chest"}).json()
    assert shared["id"] == catalogue_id and shared["muscle_group"] == "Legs"
    # LIKE wildcards in a name do not match other exercises.
    wildcard = a.post("/api/v1/exercises/custom", json={"name": "Isolation_Squat"}).json()
    assert wildcard["id"] not in (catalogue_id, custom["id"])
    with _signed_in_client("b") as b:
        assert "A secret exercise" not in b.get("/api/v1/exercises", params={"q": "secret"}).text
        assert b.delete(f"/api/v1/exercises/custom/{custom['id']}").status_code == 404
        assert b.delete(f"/api/v1/exercises/custom/{catalogue_id}").status_code == 404
        assert b.post("/api/v1/routines", json={"name": "B", "exercises": [{"exercise_id": custom["id"], "planned_sets": 1}]}).status_code == 404
        # B can have its own exercise with the same name, separate from A's.
        own = b.post("/api/v1/exercises/custom", json={"name": "A secret exercise"}).json()
        assert own["id"] != custom["id"]
        assert [item["id"] for item in b.get("/api/v1/exercises", params={"q": "secret"}).json()] == [own["id"]]
        assert any(item["id"] == catalogue_id for item in b.get("/api/v1/exercises", params={"q": "squat"}).json())
    assert [item["id"] for item in a.get("/api/v1/exercises", params={"q": "secret"}).json()] == [custom["id"]]
    with Session(engine) as db:
        assert db.get(m.Exercise, catalogue_id).primary_muscle == "Quadriceps"
        assert db.get(m.Exercise, custom["id"]).owner_email == "a@example.test"
    assert a.delete(f"/api/v1/exercises/custom/{custom['id']}").status_code == 200
    assert a.get("/api/v1/exercises", params={"q": "secret"}).json() == []


def test_signed_in_requests_cannot_change_shared_catalogue_exercises(secure_app):
    _, engine = secure_app
    with Session(engine) as db:
        catalogue = m.Exercise(wger_id="isolation-row", name="Isolation Row", equipment="Cable", primary_muscle="Lats", muscle_group="Back")
        db.add(catalogue); db.commit(); catalogue_id = catalogue.id
    with Session(engine, info={"owner_email": "a@example.test"}) as db:
        db.get(m.Exercise, catalogue_id).primary_muscle = "Chest"
        with pytest.raises(PermissionError):
            db.flush()
    with Session(engine, info={"owner_email": "a@example.test"}) as db:
        db.delete(db.get(m.Exercise, catalogue_id))
        with pytest.raises(PermissionError):
            db.flush()
    with Session(engine, info={"owner_email": "a@example.test"}) as db:
        db.add(m.Exercise(wger_id="forged", name="Forged catalogue row"))
        with pytest.raises(PermissionError):
            db.flush()
    with Session(engine) as db:
        assert db.get(m.Exercise, catalogue_id).primary_muscle == "Lats"


def test_existing_custom_exercises_are_assigned_to_the_one_account_using_them(tmp_path):
    from app.exercise_ownership import assign_custom_exercise_owners
    engine = create_engine(f"sqlite:///{tmp_path / 'owners.db'}")
    m.Base.metadata.create_all(engine)
    with Session(engine) as db:
        def exercise(name, wger_id=None):
            item = m.Exercise(name=name, wger_id=wger_id); db.add(item); db.flush(); return item.id
        catalogue, routine_only, workout_only, override_only, shared, unused = (
            exercise("Catalogue", "catalogue-1"), exercise("Routine only"), exercise("Workout only"),
            exercise("Override only"), exercise("Used by two"), exercise("Unused"))
        routine = m.Routine(name="A routine", owner_email="a@example.test"); db.add(routine); db.flush()
        db.add_all([m.RoutineExercise(routine_id=routine.id, exercise_id=routine_only, position=0, planned_sets=3),
                    m.RoutineExercise(routine_id=routine.id, exercise_id=catalogue, position=1, planned_sets=3),
                    m.RoutineExercise(routine_id=routine.id, exercise_id=shared, position=2, planned_sets=3)])
        workout = m.Workout(name="B workout", owner_email="b@example.test"); db.add(workout); db.flush()
        db.add_all([m.WorkoutExercise(workout_id=workout.id, cached_exercise_id=workout_only, name="Workout only", position=0),
                    m.WorkoutExercise(workout_id=workout.id, cached_exercise_id=shared, name="Used by two", position=1)])
        other = m.Routine(name="C routine", owner_email="c@example.test"); db.add(other); db.flush()
        db.add(m.CalendarAssignment(day=date(2026, 3, 1), owner_email="c@example.test", routine_id=other.id,
                                    workout_override=json.dumps({"exercises": [{"exercise_id": override_only}]})))
        db.commit()
    with engine.begin() as connection:
        assert assign_custom_exercise_owners(connection) == 3
    with Session(engine) as db:
        owners = {item.name: item.owner_email for item in db.scalars(select(m.Exercise))}
    assert owners == {"Catalogue": None, "Routine only": "a@example.test", "Workout only": "b@example.test",
                      "Override only": "c@example.test", "Used by two": None, "Unused": None}
    with engine.begin() as connection:
        assert assign_custom_exercise_owners(connection) == 0

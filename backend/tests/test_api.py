from fastapi.testclient import TestClient
import threading
import tempfile
from pathlib import Path
import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import app.main as main_module
from app.main import Base, app, group_for


_test_database = tempfile.TemporaryDirectory(prefix="w-tracker-api-tests-")
engine = create_engine(f"sqlite:///{Path(_test_database.name) / 'workout_tracker.db'}", connect_args={"check_same_thread": False})
main_module.engine = engine
main_module.SessionLocal = sessionmaker(bind=engine, autoflush=False, info={"owner_email": "test@example.com"})


@pytest.fixture(scope="module", autouse=True)
def _close_test_database():
    yield
    engine.dispose()
    _test_database.cleanup()

app.state.disable_catalogue_refresh = True
app.state.disable_auth = True
client = TestClient(app)


def test_all_wger_muscles_map_to_dashboard_groups():
    expected = {
        "Anterior deltoid": "Shoulders", "Pectoralis major": "Chest",
        "Biceps femoris": "Legs", "Gluteus maximus": "Legs",
        "Quadriceps femoris": "Legs", "Gastrocnemius": "Legs",
        "Latissimus dorsi": "Back", "Trapezius": "Back",
        "Rectus abdominis": "Core", "Obliquus externus abdominis": "Core",
        "Biceps brachii": "Arms", "Triceps brachii": "Arms", "Brachialis": "Arms",
    }
    assert {muscle: group_for(muscle) for muscle in expected} == expected


def reset_db():
    main_module.RATE_LIMIT_BUCKETS.clear()
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    app.router.on_startup[0]()
    with main_module.SessionLocal() as db:
        main_module.store_exercise(db, "Bench press", "Barbell", "Pectoralis major")
        main_module.store_exercise(db, "Seated row", "Cable", "Latissimus dorsi")
        db.commit()


def test_routine_to_workout_updates_volume_and_all_groups_present():
    reset_db()
    exercises = client.get("/api/v1/exercises").json()
    chest = next(item for item in exercises if item["muscle_group"] == "Chest")
    folder = client.post("/api/v1/folders", json={"name": "Upper"}).json()
    assert folder["saved"] is True
    routine = client.post("/api/v1/routines", json={
        "name": "Push", "folder_id": folder["id"],
        "exercises": [{"exercise_id": chest["id"], "planned_sets": 3, "target_reps": 8, "target_weight": 60}],
    }).json()
    draft = client.post(f"/api/v1/routines/{routine['id']}/start").json()
    response = client.put(f"/api/v1/workouts/{draft['id']}", json={
        "name": draft["name"], "performed_on": draft["performed_on"],
        "exercises": [{"exercise_id": chest["id"], "sets": [{"weight": 60, "reps": 8}] * 3}],
    })
    assert response.status_code == 200
    assert response.json()["saved"] is True
    dashboard = client.get("/api/v1/dashboard").json()
    groups = {item["name"]: item["current_week_volume"] for item in dashboard["volume_by_muscle_group"]}
    assert set(groups) == {"Legs", "Back", "Core", "Chest", "Shoulders", "Arms"}
    assert groups["Chest"] == 1440


def test_completed_workout_note_can_be_saved_and_read():
    reset_db()
    created = client.post("/api/v1/workouts", json={
        "name": "Full body", "performed_on": "2026-09-25", "exercises": [],
    }).json()
    updated = client.patch(f"/api/v1/workouts/{created['id']}", json={
        "name": "Full body", "performed_on": "2026-09-25",
        "note": "Felt strong today", "exercises": [],
    })
    assert updated.status_code == 200
    assert updated.json()["note"] == "Felt strong today"
    workouts = client.get("/api/v1/workouts").json()
    assert next(item for item in workouts if item["id"] == created["id"])["note"] == "Felt strong today"


def test_dashboard_counts_sets_for_each_individual_muscle_worked():
    reset_db()
    with main_module.SessionLocal() as db:
        exercise = db.scalar(main_module.select(main_module.Exercise).where(main_module.Exercise.name == "Bench press"))
        exercise.secondary_muscles = "Anterior deltoid|Triceps brachii"
        db.commit()
        exercise_id = exercise.id
    draft = client.post("/api/v1/workouts/draft", json={"name": "Push", "performed_on": str(main_module.date.today())}).json()
    client.put(f"/api/v1/workouts/{draft['id']}", json={
        "name": "Push", "performed_on": str(main_module.date.today()),
        "exercises": [{"exercise_id": exercise_id, "sets": [{"weight": 60, "reps": 8}] * 3}],
    })
    sets = {item["name"]: item["current_week_sets"] for item in client.get("/api/v1/dashboard").json()["sets_by_muscle"]}
    assert sets["Pectoralis major"] == 3
    assert sets["Front delts"] == 3
    assert sets["Triceps"] == 3


def test_bodyweight_entry_is_upserted_by_day():
    reset_db()
    payload = {"recorded_on": "2026-09-01", "weight": 82.5}
    assert client.post("/api/v1/bodyweight", json=payload).json()["saved"] is True
    assert client.post("/api/v1/bodyweight", json={**payload, "weight": 82.2}).json()["saved"] is True
    entries = client.get("/api/v1/bodyweight").json()
    assert entries == [{"recorded_on": "2026-09-01", "weight": 82.2}]


def test_drafts_can_be_resumed_and_progress_is_available():
    reset_db()
    exercise = client.get("/api/v1/exercises").json()[0]
    draft = client.post("/api/v1/workouts/draft", json={"name": "Quick session", "performed_on": "2026-09-02"}).json()
    assert client.get("/api/v1/workouts/active").json()[0]["id"] == draft["id"]
    finished = client.put(f"/api/v1/workouts/{draft['id']}", json={
        "name": "Quick session", "performed_on": "2026-09-02",
        "exercises": [{"exercise_id": exercise["id"], "sets": [{"weight": 50, "reps": 10}]}],
    })
    assert finished.status_code == 200
    progress = client.get(f"/api/v1/exercises/{exercise['id']}/progress").json()
    assert progress["sessions"][0]["best_weight"] == 50
    assert client.delete(f"/api/v1/workouts/{draft['id']}").json() == {"deleted": True, "saved": True}


def test_workout_progress_is_fetched_in_one_batch():
    reset_db()
    exercises = client.get("/api/v1/exercises").json()[:2]
    completed = client.post("/api/v1/workouts/draft", json={"name": "Previous", "performed_on": "2026-09-01"}).json()
    client.put(f"/api/v1/workouts/{completed['id']}", json={
        "name": "Previous", "performed_on": "2026-09-01",
        "exercises": [{"exercise_id": exercise["id"], "sets": [{"weight": 40 + index * 10, "reps": 8}]} for index, exercise in enumerate(exercises)],
    })
    active = client.post("/api/v1/workouts/draft", json={"name": "Current", "performed_on": "2026-09-02"}).json()
    client.patch(f"/api/v1/workouts/{active['id']}", json={
        "name": "Current", "performed_on": "2026-09-02",
        "exercises": [{"exercise_id": exercise["id"], "sets": [{"weight": 0, "reps": 8}]} for exercise in exercises],
    })
    progress = client.get(f"/api/v1/workouts/{active['id']}/exercise-progress")
    assert progress.status_code == 200
    payload = progress.json()
    assert set(payload) == {str(exercise["id"]) for exercise in exercises}
    assert [payload[str(exercise["id"])]["sessions"][0]["best_weight"] for exercise in exercises] == [40, 50]


def test_folders_never_refreshes_wger(monkeypatch):
    reset_db()
    monkeypatch.setattr(main_module, "sync_wger_catalogue", lambda _db: (_ for _ in ()).throw(AssertionError("unexpected refresh")))
    response = client.get("/api/v1/folders")
    assert response.status_code == 200


def test_background_catalogue_refresh_uses_its_own_session_and_starts_once(monkeypatch):
    calls = []
    started = threading.Event()
    release = threading.Event()

    class FakeSession:
        def __enter__(self):
            calls.append(self)
            return self

        def __exit__(self, *_args):
            return False

        def rollback(self):
            calls.append("rollback")

    fake_session = FakeSession()
    monkeypatch.setattr(main_module, "SessionLocal", lambda **_kwargs: fake_session)
    def refresh(db):
        calls.append(db)
        started.set()
        release.wait(timeout=2)

    monkeypatch.setattr(main_module, "sync_wger_catalogue", refresh)
    main_module.CATALOGUE_REFRESH_THREAD = None

    first = main_module.start_catalogue_refresh_background()
    assert started.wait(timeout=2)
    second = main_module.start_catalogue_refresh_background()
    release.set()
    first.join(timeout=2)

    assert first is second
    assert calls == [fake_session, fake_session]


def test_background_catalogue_failure_is_contained(monkeypatch):
    class FailingSession:
        rolled_back = False

        def __enter__(self): return self
        def __exit__(self, *_args): return False
        def rollback(self): self.rolled_back = True

    session = FailingSession()
    monkeypatch.setattr(main_module, "SessionLocal", lambda **_kwargs: session)
    monkeypatch.setattr(main_module, "sync_wger_catalogue", lambda _db: (_ for _ in ()).throw(ValueError("bad catalogue")))

    main_module.refresh_wger_catalogue_background()

    assert session.rolled_back is True


def test_muscle_labels_are_normalized_and_not_rewrapped():
    reset_db()
    with main_module.SessionLocal() as db:
        exercise = db.scalar(main_module.select(main_module.Exercise).where(main_module.Exercise.name == "Bench press"))
        exercise.primary_muscle = "Primary: Primary: Chest · Secondary: Shoulders, Triceps"
        exercise.secondary_muscles = "Secondary: Shoulders|Triceps|Shoulders"
        db.commit()

    first = next(item for item in client.get("/api/v1/exercises").json() if item["name"] == "Bench press")
    second = next(item for item in client.get("/api/v1/exercises").json() if item["name"] == "Bench press")

    assert first["primary_muscle"] == "Primary: Chest · Secondary: Shoulders, Triceps"
    assert second["primary_muscle"] == first["primary_muscle"]
    assert second["secondary_muscles"] == ["Shoulders", "Triceps"]


class _FakeInteraction:
    steps = []
    output_text = "Your recent training is progressing steadily."


class _FakeInteractions:
    def create(self, **_kwargs):
        return _FakeInteraction()


class _FakeGeminiClient:
    interactions = _FakeInteractions()


def test_ai_conversation_stream_is_persisted_and_uses_sse(monkeypatch):
    reset_db()
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    monkeypatch.setenv("GEMINI_MODEL", "test-model")
    app.state.gemini_client_factory = _FakeGeminiClient
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Coach"}).json()
    response = client.post(f"/api/v1/ai/conversations/{conversation['id']}/messages", json={"content": "How is my training going?"})
    assert response.status_code == 200
    assert "event: message.started" in response.text
    assert "event: text.delta" in response.text
    assert "event: message.completed" in response.text
    stored = client.get(f"/api/v1/ai/conversations/{conversation['id']}").json()
    assert [message["role"] for message in stored["messages"]] == ["user", "assistant"]
    assert stored["messages"][-1]["status"] == "completed"
    del app.state.gemini_client_factory


def test_ai_retry_reuses_latest_user_message(monkeypatch):
    reset_db()
    monkeypatch.setenv("GEMINI_API_KEY", "test")
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Coach"}).json()
    with main_module.SessionLocal() as db:
        db.add(main_module.AIMessage(conversation_id=conversation["id"], role="user", content="Help my jump", status="completed"))
        db.flush()
        user_id = db.scalar(main_module.select(main_module.AIMessage.id).where(main_module.AIMessage.conversation_id == conversation["id"], main_module.AIMessage.role == "user"))
        db.add(main_module.AIMessage(conversation_id=conversation["id"], role="assistant", content="", status="failed"))
        db.commit()
    app.state.gemini_client_factory = _FakeGeminiClient
    response = client.post(f"/api/v1/ai/conversations/{conversation['id']}/retry", json={"user_message_id": user_id})
    assert response.status_code == 200
    assert "event: message.completed" in response.text
    stored = client.get(f"/api/v1/ai/conversations/{conversation['id']}").json()
    assert [message["role"] for message in stored["messages"]] == ["user", "assistant", "assistant"]
    assert client.post(f"/api/v1/ai/conversations/{conversation['id']}/retry", json={"user_message_id": user_id}).status_code == 409
    del app.state.gemini_client_factory


def test_authentication_fails_closed(monkeypatch):
    reset_db()
    app.state.disable_auth = False
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "client.apps.googleusercontent.com")
    monkeypatch.setenv("ALLOWED_EMAILS", "allowed@example.com")
    try:
        assert client.get("/api/v1/session").status_code == 401

        monkeypatch.setattr(main_module.id_token, "verify_oauth2_token", lambda *_args: (_ for _ in ()).throw(ValueError("bad audience")))
        assert client.get("/api/v1/session", headers={"Authorization": "Bearer invalid"}).status_code == 401

        monkeypatch.setattr(main_module.id_token, "verify_oauth2_token", lambda *_args: {"email": "allowed@example.com", "email_verified": False})
        assert client.get("/api/v1/session", headers={"Authorization": "Bearer token"}).status_code == 403

        monkeypatch.setattr(main_module.id_token, "verify_oauth2_token", lambda *_args: {"email": "other@example.com", "email_verified": True})
        assert client.get("/api/v1/session", headers={"Authorization": "Bearer token"}).status_code == 403

        monkeypatch.setattr(main_module.id_token, "verify_oauth2_token", lambda *_args: {"email": "allowed@example.com", "email_verified": True, "name": "Allowed Person", "given_name": "Allowed"})
        response = client.get("/api/v1/session", headers={"Authorization": "Bearer token"})
        assert response.status_code == 200
        assert response.json() == {"email": "allowed@example.com", "name": "Allowed Person", "given_name": "Allowed"}

        monkeypatch.delenv("GOOGLE_CLIENT_ID")
        assert client.get("/api/v1/session", headers={"Authorization": "Bearer token"}).status_code == 503
    finally:
        app.state.disable_auth = True


def test_personal_data_is_isolated_between_allowlisted_users():
    reset_db()
    app.state.test_user_email = "alice@example.com"
    folder = client.post("/api/v1/folders", json={"name": "Alice"}).json()
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Private"}).json()
    client.post("/api/v1/bodyweight", json={"recorded_on": str(main_module.date.today()), "weight": 70})

    app.state.test_user_email = "bob@example.com"
    try:
        assert client.get("/api/v1/folders").json() == []
        assert client.get("/api/v1/bodyweight").json() == []
        assert client.get("/api/v1/ai/conversations").json() == []
        assert client.delete(f"/api/v1/folders/{folder['id']}").status_code == 404
        assert client.get(f"/api/v1/ai/conversations/{conversation['id']}").status_code == 404
    finally:
        app.state.test_user_email = "test@example.com"


def test_request_size_and_rate_limit_responses_include_expected_metadata(monkeypatch):
    reset_db()
    too_large = client.post("/api/v1/folders", content=b"{}", headers={"Content-Length": "1048577"})
    assert too_large.status_code == 413

    monkeypatch.setattr(main_module, "_rate_limit", lambda *_args, **_kwargs: 17)
    limited = client.get("/api/v1/folders")
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "17"


def test_ai_routine_proposal_requires_confirmation():
    reset_db()
    from app.tools import execute_tool
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Plan changes"}).json()
    exercise = client.get("/api/v1/exercises").json()[0]
    result = execute_tool("propose_create_routine", {"routine": {"name": "AI Push", "exercises": [{"exercise_id": exercise["id"], "planned_sets": 3, "target_reps_min": 8, "target_reps_max": 12, "rest_seconds": 90}]}, "summary": "Create a push routine"}, conversation["id"], None, "test@example.com")
    assert result["status"] == "pending"
    detail = client.get(f"/api/v1/ai/conversations/{conversation['id']}").json()
    assert detail["proposals"][0]["exercise_names_by_id"][str(exercise["id"])] == exercise["name"]
    assert all(routine["name"] != "AI Push" for folder in client.get("/api/v1/folders").json() for routine in folder["routines"])
    applied = client.post(f"/api/v1/ai/proposals/{result['proposal_id']}/confirm")
    assert applied.status_code == 200
    assert applied.json()["status"] == "applied"
    assert client.post(f"/api/v1/ai/proposals/{result['proposal_id']}/confirm").status_code == 200
    with main_module.SessionLocal() as db:
        assert db.scalar(main_module.select(main_module.Routine).where(main_module.Routine.name == "AI Push")) is not None


def test_ai_reject_and_stale_routine_proposal():
    reset_db()
    from app.tools import execute_tool
    exercise = client.get("/api/v1/exercises").json()[0]
    routine = client.post("/api/v1/routines", json={"name": "Original", "exercises": [{"exercise_id": exercise["id"], "planned_sets": 3}]}).json()
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Changes"}).json()
    args = {"routine_id": routine["id"], "routine": {"name": "Revised", "exercises": [{"exercise_id": exercise["id"], "planned_sets": 4}]}, "summary": "Increase volume"}
    rejected = execute_tool("propose_update_routine", args, conversation["id"], None, "test@example.com")
    assert client.post(f"/api/v1/ai/proposals/{rejected['proposal_id']}/reject").json()["status"] == "rejected"
    stale = execute_tool("propose_update_routine", args, conversation["id"], None, "test@example.com")
    client.put(f"/api/v1/routines/{routine['id']}", json={"name": "Manual edit", "exercises": [{"exercise_id": exercise["id"], "planned_sets": 2}]})
    response = client.post(f"/api/v1/ai/proposals/{stale['proposal_id']}/confirm")
    assert response.status_code == 409
    assert "changed" in response.json()["detail"]


def test_ai_message_rejects_missing_configuration_and_concurrent_turn(monkeypatch):
    reset_db()
    conversation = client.post("/api/v1/ai/conversations", json={"title": "Coach"}).json()
    monkeypatch.delenv("GEMINI_API_KEY", raising=False); monkeypatch.delenv("GEMINI_MODEL", raising=False)
    assert client.post(f"/api/v1/ai/conversations/{conversation['id']}/messages", json={"content": "Review my plan"}).status_code == 503
    monkeypatch.setenv("GEMINI_API_KEY", "test"); monkeypatch.setenv("GEMINI_MODEL", "test-model")
    with main_module.SessionLocal() as db:
        item = db.get(main_module.AIConversation, conversation["id"]); item.status = "generating"; item.updated_at = main_module.datetime.utcnow(); db.commit()
    assert client.post(f"/api/v1/ai/conversations/{conversation['id']}/messages", json={"content": "Review my plan"}).status_code == 409

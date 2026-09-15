from fastapi.testclient import TestClient
import threading

import app.main as main_module
from app.main import Base, engine, app, group_for


app.state.disable_catalogue_refresh = True
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
    monkeypatch.setattr(main_module, "SessionLocal", lambda: fake_session)
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
    monkeypatch.setattr(main_module, "SessionLocal", lambda: session)
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

from fastapi.testclient import TestClient

from app.main import Base, engine, app, group_for


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

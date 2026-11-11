from datetime import date, timedelta
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session, sessionmaker

import app.main as m
import app.demo as demo

OWNER = "felixpj8h@gmail.com"
OTHER = "other-private@example.com"


@pytest.fixture
def public_demo(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'demo.db'}", connect_args={"check_same_thread": False})
    m.Base.metadata.create_all(engine)
    monkeypatch.setattr(m, "engine", engine)
    monkeypatch.setattr(m, "SessionLocal", sessionmaker(bind=engine, autoflush=False))
    monkeypatch.setattr(m, "APP_ENV", "production")
    monkeypatch.setenv("DEMO_ENABLED", "true")
    monkeypatch.setenv("DEMO_OWNER_EMAIL", OWNER)
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "test-client")
    monkeypatch.setenv("PUBLIC_ORIGIN", "https://testserver")
    monkeypatch.setenv("ALLOWED_EMAILS", OWNER)
    monkeypatch.setattr(m.app.state, "disable_auth", False, raising=False)
    monkeypatch.setattr(m, "WGER_MUSCLES", None)
    m.RATE_LIMIT_BUCKETS.clear()
    ids = {}
    with Session(engine) as db:
        exercise = m.Exercise(name="Public bench", equipment="Barbell", primary_muscle="Chest", muscle_group="Chest")
        private_exercise = m.Exercise(name="OTHER_PRIVATE_EXERCISE", equipment="Cable")
        db.add_all([exercise, private_exercise]); db.flush()
        ids["exercise"] = exercise.id
        ids["private_exercise"] = private_exercise.id
        for owner in (OWNER, OTHER):
            folder = m.RoutineFolder(owner_email=owner, name="Public folder" if owner == OWNER else "OTHER_PRIVATE_FOLDER")
            routine = m.Routine(owner_email=owner, name="Public routine" if owner == OWNER else "OTHER_PRIVATE_ROUTINE", folder=folder,
                exercises=[m.RoutineExercise(exercise=exercise, position=0, planned_sets=3, target_reps=8)])
            done = m.Workout(owner_email=owner, name="Public workout" if owner == OWNER else "OTHER_PRIVATE_WORKOUT",
                completed=True, performed_on=date.today(), note="PRIVATE_WORKOUT_NOTE",
                exercises=[m.WorkoutExercise(cached_exercise_id=exercise.id, name="Public bench", position=0,
                    primary_muscle="Chest", muscle_group="Chest", note="PRIVATE_EXERCISE_NOTE",
                    sets=[m.WorkoutSet(position=0, weight=60, reps=8)])])
            draft = m.Workout(owner_email=owner, name="PRIVATE_DRAFT", completed=False)
            weight = m.BodyweightEntry(owner_email=owner, recorded_on=date.today(), weight=80 if owner == OWNER else 12345.6)
            conversation = m.AIConversation(owner_email=owner, title="PRIVATE_COACH")
            db.add_all([folder, routine, done, draft, weight, conversation]); db.flush()
            ids[owner] = {"routine": routine.id, "workout": done.id, "draft": draft.id}
            plan = m.WeeklyPlan(owner_email=owner, name="Public plan" if owner == OWNER else "OTHER_PRIVATE_PLAN", starts_on=date.today(),
                days=[m.WeeklyPlanDay(weekday=date.today().weekday(), routine=routine)])
            assignment = m.CalendarAssignment(owner_email=owner, day=date.today() + timedelta(days=1), routine=routine,
                workout_override=json.dumps({"name": "Public override" if owner == OWNER else "OTHER_PRIVATE_OVERRIDE",
                    "note": "PRIVATE_OVERRIDE_NOTE", "owner_email": OTHER,
                    "exercises": [{"exercise_id": exercise.id, "planned_sets": 2, "note": "PRIVATE_NESTED_NOTE"}]}))
            db.add_all([plan, assignment])
        db.commit()
    browser = TestClient(m.app, base_url="https://testserver")
    yield browser, engine, ids
    browser.close()
    if demo._engine is not None:
        demo._engine.dispose()
        demo._engine = None
    engine.dispose()


def routes(ids):
    return ["/dashboard", "/dashboard/body-map", "/folders", f"/routines/{ids[OWNER]['routine']}",
        "/workouts", f"/workouts/{ids[OWNER]['workout']}", "/calendar/plan",
        f"/calendar?year={date.today().year}&month={date.today().month}",
        f"/exercises/{ids['exercise']}/progress", f"/workouts/{ids[OWNER]['workout']}/exercise-progress"]


def test_public_bodyweight_is_scoped_live_and_read_only(public_demo):
    client, engine, _ids = public_demo
    earlier = date.today() - timedelta(days=2)
    with Session(engine) as db:
        db.add(m.BodyweightEntry(owner_email=OWNER, recorded_on=earlier, weight=79.5))
        db.commit()
    response = client.get("/api/v1/demo/dashboard")
    assert response.status_code == 200
    data = response.json()
    assert data["weight_series"] == [
        {"recorded_on": str(earlier), "weight": 79.5},
        {"recorded_on": str(date.today()), "weight": 80},
    ]
    assert data["latest_weight"] == data["weight_series"][-1]
    with Session(engine) as db:
        entry = db.scalar(select(m.BodyweightEntry).where(m.BodyweightEntry.owner_email == OWNER,
            m.BodyweightEntry.recorded_on == date.today()))
        entry.weight = 81
        db.commit()
    assert client.get("/api/v1/demo/dashboard").json()["latest_weight"]["weight"] == 81
    assert client.post("/api/v1/demo/dashboard", json={"weight": 99}).status_code == 405
    assert client.post("/api/v1/bodyweight", json={"weight": 99, "recorded_on": str(date.today())}).status_code == 401
    with Session(engine) as db:
        for entry in db.scalars(select(m.BodyweightEntry).where(m.BodyweightEntry.owner_email == OWNER)):
            db.delete(entry)
        db.commit()
    data = client.get("/api/v1/demo/dashboard").json()
    assert data["latest_weight"] is None
    assert data["weight_series"] == []


def test_public_history_is_paged_scoped_and_uses_bounded_queries(public_demo):
    client, engine, ids = public_demo
    with Session(engine) as db:
        for index in range(135):
            db.add(m.Workout(owner_email=OWNER, name=f"Paged {index}", completed=True,
                performed_on=date.today(), exercises=[m.WorkoutExercise(name="Bench", position=0,
                    cached_exercise_id=ids["exercise"], sets=[m.WorkoutSet(position=0, weight=50, reps=5)])]))
        db.commit()
    statements = []
    readonly = demo.readonly_engine()
    def capture(_connection, _cursor, statement, *_args):
        statements.append(statement)
    event.listen(readonly, "before_cursor_execute", capture)
    try:
        page = client.get("/api/v1/demo/workouts").json()
        assert len(page["items"]) == 25
        assert page["total_sessions"] == 136
        assert len(statements) <= 10
        identities = [item["id"] for item in page["items"]]
        while page["next_cursor"]:
            page = client.get("/api/v1/demo/workouts", params={"cursor": page["next_cursor"]}).json()
            identities.extend(item["id"] for item in page["items"])
        assert len(identities) == len(set(identities)) == 136
        statements.clear()
        progress = client.get(f"/api/v1/demo/workouts/{ids[OWNER]['workout']}/exercise-progress")
        assert progress.status_code == 200
        assert len(next(iter(progress.json().values()))["sessions"]) <= 100
        assert len(statements) <= 12
    finally:
        event.remove(readonly, "before_cursor_execute", capture)
    assert client.get("/api/v1/demo/workouts", params={"q": "%"}).json()["total_sessions"] == 0
    assert client.get("/api/v1/demo/workouts", params={"q": "Paged 134"}).json()["total_sessions"] == 1
    assert client.get("/api/v1/demo/workouts", params={"limit": 101}).status_code == 422
    assert client.get("/api/v1/demo/workouts", params={"week": str(date.today())}).json()["total_sessions"] == 136
    assert client.get("/api/v1/demo/workouts", params={"week": str(date.today() - timedelta(days=7))}).json()["total_sessions"] == 0
    with Session(engine) as db:
        db.add(m.Workout(owner_email=OWNER, name="ØKT", completed=True, performed_on=date.today()))
        db.commit()
    assert client.get("/api/v1/demo/workouts", params={"q": "økt"}).json()["total_sessions"] == 1


def test_proxy_middleware_ignores_forwarding_from_untrusted_peers(public_demo):
    import time
    from collections import deque
    from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

    ip = "198.51.100.20"
    m.RATE_LIMIT_BUCKETS[(ip, "demo-read")] = deque([time.monotonic()] * 120)
    wrapped = ProxyHeadersMiddleware(m.app, trusted_hosts=["10.0.0.10"])
    with TestClient(wrapped, client=(ip, 1234)) as browser:
        for forwarded in (ip, f"203.0.113.45, {ip}"):
            response = browser.get("/api/v1/demo/workouts", headers={"X-Forwarded-For": forwarded})
            assert response.status_code == 429


def test_workout_progress_does_not_publish_unlinked_catalogue_matches(public_demo):
    client, engine, ids = public_demo
    with Session(engine) as db:
        exercise = db.scalar(select(m.WorkoutExercise).where(
            m.WorkoutExercise.workout_id == ids[OWNER]["workout"]))
        exercise.cached_exercise_id = None
        db.commit()
    response = client.get(f"/api/v1/demo/workouts/{ids[OWNER]['workout']}/exercise-progress")
    assert response.status_code == 200
    assert response.json() == {}


def test_public_projection_is_scoped_private_field_free_and_no_side_effects(public_demo, monkeypatch):
    client, engine, ids = public_demo
    monkeypatch.setattr(m.httpx, "Client", lambda *_a, **_k: pytest.fail("Demo made an upstream request"))
    reads = []
    readonly = demo.readonly_engine()
    def capture(_c, _cursor, statement, *_args):
        reads.append(statement.lower())
    event.listen(readonly, "before_cursor_execute", capture)
    try:
        for route in routes(ids):
            response = client.get("/api/v1/demo" + route,
                headers={"Authorization": "Bearer forged", "Cookie": f"{m.SESSION_COOKIE}=forged"})
            assert response.status_code == 200, response.text
            assert response.headers["cache-control"] == "no-store"
            assert "set-cookie" not in response.headers
            for secret in (OWNER, OTHER, "OTHER_PRIVATE", "PRIVATE_", "12345.6", '"note"', '"owner_email"'):
                assert secret not in response.text
        assert any("bodyweight_entries" in sql for sql in reads)
        assert not any("ai_conversations" in sql for sql in reads)
        assert not any(sql.lstrip().startswith(("insert", "update", "delete")) for sql in reads)
    finally:
        event.remove(readonly, "before_cursor_execute", capture)
    assert client.get("/api/v1/workouts").status_code == 401
    assert client.post("/api/v1/bodyweight", json={"weight": 99, "recorded_on": str(date.today())}).status_code == 401
    assert client.get("/api/v1/session", headers={"X-Demo": "true"}).status_code == 401


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE", "HEAD", "TRACE", "CONNECT"])
def test_all_demo_routes_reject_unsupported_methods(public_demo, method):
    client, engine, ids = public_demo
    with engine.connect() as db:
        before = db.exec_driver_sql("SELECT * FROM workouts").all()
    for route in routes(ids):
        assert client.request(method, "/api/v1/demo" + route).status_code == 405
    with engine.connect() as db:
        assert db.exec_driver_sql("SELECT * FROM workouts").all() == before
    assert client.request(method, "/api/v1/demo/unknown").status_code == 404


def test_id_tampering_and_owner_selection(public_demo):
    client, _engine, ids = public_demo
    for route in (f"/routines/{ids[OTHER]['routine']}", f"/workouts/{ids[OTHER]['workout']}",
        f"/workouts/{ids[OWNER]['draft']}", f"/workouts/{ids[OTHER]['workout']}/exercise-progress",
        f"/exercises/{ids['private_exercise']}/progress",
        f"/exercises/{ids['exercise']}/progress?exclude_workout_id={ids[OTHER]['workout']}"):
        assert client.get("/api/v1/demo" + route).status_code == 404
    for route in ("/ai/conversations", "/bodyweight", "/workouts/active", "/exercises", "/session", "/dashboard/body-map/test-data"):
        assert client.get("/api/v1/demo" + route).status_code == 404
    response = client.get(f"/api/v1/demo/workouts?owner_email={OTHER}", headers={"X-Demo-Owner": OTHER})
    assert "Public workout" in response.text and "OTHER_PRIVATE" not in response.text


def test_demo_cannot_write_even_when_handlers_or_orm_attempt_it(public_demo):
    _client, _engine, _ids = public_demo
    with demo.readonly_engine().connect() as db:
        assert db.exec_driver_sql("PRAGMA query_only").scalar() == 1
        with pytest.raises(DBAPIError):
            db.exec_driver_sql("DELETE FROM workouts")
    with demo.ReadOnlySession(bind=demo.readonly_engine(), info={"owner_email": OWNER}) as db:
        with pytest.raises(PermissionError):
            db.execute(update(m.Workout).values(name="tampered"))
        db.add(m.Workout(name="tampered", owner_email=OWNER))
        with pytest.raises(PermissionError):
            db.commit()


def test_disabled_or_missing_configuration_fails_closed(public_demo, monkeypatch):
    client, _engine, _ids = public_demo
    monkeypatch.setenv("DEMO_ENABLED", "false")
    assert client.get("/api/v1/demo/workouts").status_code == 404
    monkeypatch.setenv("DEMO_ENABLED", "true")
    monkeypatch.delenv("DEMO_OWNER_EMAIL")
    assert client.get("/api/v1/demo/workouts").status_code == 404


def test_reads_are_live_and_existing_authenticated_edits_work(public_demo):
    client, engine, ids = public_demo
    client.cookies.set(m.SESSION_COOKIE, m._session_value({"email": OWNER, "name": "Felix", "given_name": "Felix"}))
    response = client.put(f"/api/v1/folders/1", json={"name": "Updated publicly"}, headers={"Origin": "https://testserver"})
    assert response.status_code == 200
    assert "Updated publicly" in client.get("/api/v1/demo/folders").text
    assert client.get("/api/v1/session").json()["email"] == OWNER
    client.get("/api/v1/demo/workouts")
    assert client.get("/api/v1/session").json()["email"] == OWNER


def test_cross_owner_relationships_are_hidden(public_demo):
    client, engine, ids = public_demo
    with Session(engine) as db:
        owned_plan = db.scalar(select(m.WeeklyPlan).where(m.WeeklyPlan.owner_email == OWNER))
        owned_plan.days.append(m.WeeklyPlanDay(weekday=(date.today().weekday() + 1) % 7, routine_id=ids[OTHER]["routine"]))
        db.add(m.CalendarAssignment(owner_email=OWNER, day=date.today() + timedelta(days=2), routine_id=ids[OTHER]["routine"]))
        db.commit()
    for route in ("/calendar/plan", f"/calendar?year={date.today().year}&month={date.today().month}"):
        response = client.get("/api/v1/demo" + route)
        assert response.status_code == 200
        assert "OTHER_PRIVATE" not in response.text


def test_demo_calendar_shows_only_public_owner_day_labels(public_demo):
    client, engine, _ids = public_demo
    with Session(engine) as db:
        own = m.CalendarLabel(owner_email=OWNER, name="Sick", color="rose")
        other = m.CalendarLabel(owner_email=OTHER, name="OTHER_PRIVATE_LABEL", color="sky")
        db.add_all([own, other]); db.flush()
        db.add(m.CalendarDayLabel(owner_email=OWNER, day=date.today(), label_id=own.id))
        db.add(m.CalendarDayLabel(owner_email=OTHER, day=date.today() + timedelta(days=1), label_id=other.id))
        db.commit()
    response = client.get(f"/api/v1/demo/calendar?year={date.today().year}&month={date.today().month}")
    assert response.status_code == 200
    days = response.json()["days"]
    assert next(day for day in days if day["date"] == date.today().isoformat())["label"]["name"] == "Sick"
    assert "OTHER_PRIVATE_LABEL" not in response.text


def test_demo_calendar_cancellation_suppresses_only_the_scheduled_occurrence(public_demo):
    client, engine, ids = public_demo
    cancelled = date(2026, 11, 2)
    completed = cancelled + timedelta(days=7)
    next_occurrence = completed + timedelta(days=7)
    routine_id = ids[OWNER]["routine"]
    workout_id = ids[OWNER]["workout"]
    with Session(engine) as db:
        plan = db.scalar(select(m.WeeklyPlan).where(m.WeeklyPlan.owner_email == OWNER))
        plan.starts_on = cancelled
        plan.days[0].weekday = cancelled.weekday()
        assignment = db.scalar(select(m.CalendarAssignment).where(m.CalendarAssignment.owner_email == OWNER))
        assignment.day = cancelled
        assignment.workout_override = json.dumps({"cancelled": True})
        workout = db.get(m.Workout, workout_id)
        workout.performed_on = completed
        label = m.CalendarLabel(owner_email=OWNER, name="Travel", color="rose")
        db.add(label)
        db.flush()
        db.add(m.CalendarAssignment(owner_email=OWNER, day=completed, routine_id=routine_id,
                                    workout_override=json.dumps({"cancelled": True})))
        db.add(m.CalendarDayLabel(owner_email=OWNER, day=completed, label_id=label.id))
        db.commit()

    response = client.get("/api/v1/demo/calendar?year=2026&month=11")
    assert response.status_code == 200
    days = {day["date"]: day for day in response.json()["days"]}
    for day, status in ((cancelled, "empty"), (completed, "completed")):
        occurrence = days[day.isoformat()]
        assert occurrence["status"] == status
        assert occurrence["routine_id"] is None
        assert occurrence["routine_name"] is None
        assert occurrence["routine_override"] is None
    assert days[completed.isoformat()]["workout_id"] == workout_id
    assert days[completed.isoformat()]["label"]["name"] == "Travel"
    assert days[next_occurrence.isoformat()]["routine_id"] == routine_id


def test_demo_rate_limit_ignores_spoofed_forwarded_ip(public_demo):
    client, _engine, _ids = public_demo
    m._rate_limit("testclient", "demo-read", 1)
    from collections import deque
    import time
    m.RATE_LIMIT_BUCKETS[("testclient", "demo-read")] = deque([time.monotonic()] * 120)
    response = client.get("/api/v1/demo/workouts", headers={"X-Forwarded-For": "1.2.3.4"})
    assert response.status_code == 429 and "retry-after" in response.headers


def test_invalid_stored_override_fails_closed(public_demo):
    client, engine, _ids = public_demo
    with Session(engine) as db:
        assignment = db.scalar(select(m.CalendarAssignment).where(m.CalendarAssignment.owner_email == OWNER))
        assignment.workout_override = "PRIVATE_CORRUPTED_JSON"
        db.commit()
    day = date.today() + timedelta(days=1)
    response = client.get(f"/api/v1/demo/calendar?year={day.year}&month={day.month}")
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert "PRIVATE" not in response.text and OWNER not in response.text


def test_bundled_body_map_only_exposes_trusted_https_images(public_demo, monkeypatch):
    client, _engine, _ids = public_demo
    monkeypatch.setattr(demo, "BUNDLED_MUSCLES", [
        {"id": i, "name_en": "Pectoralis major", "is_front": True, "image_url_main": url}
        for i, url in enumerate(("https://wger.de/static/chest.svg", "https://untrusted.example/track.svg", "http://wger.de/chest.svg"), 1)
    ])
    monkeypatch.setattr(m.httpx, "Client", lambda *_a, **_k: pytest.fail("Demo made an upstream request"))
    response = client.get("/api/v1/demo/dashboard/body-map")
    assert response.status_code == 200
    assert [item["id"] for item in response.json()["muscles"]] == [1]


@pytest.mark.parametrize("cached_catalogue", [None, []])
def test_demo_heatmap_works_on_cold_start_for_selected_previous_week(public_demo, monkeypatch, cached_catalogue):
    client, engine, ids = public_demo
    monday = date.today() - timedelta(days=date.today().weekday())
    previous_monday = monday - timedelta(days=7)
    with Session(engine) as db:
        completed = db.scalar(select(m.Workout).where(m.Workout.owner_email == OWNER, m.Workout.completed == True))
        completed.performed_on = previous_monday
        exercise = m.WorkoutExercise(cached_exercise_id=ids['exercise'], name='Public bench', primary_muscle='Chest', muscle_group='Chest', position=0,
            sets=[m.WorkoutSet(position=0, weight=25, reps=10)])
        db.add(m.Workout(owner_email=OWNER, name='Current week', performed_on=monday, completed=True, exercises=[exercise]))
        db.commit()
        expected = sum(s.weight * s.reps for ex in completed.exercises for s in ex.sets)
    monkeypatch.setattr(m, 'WGER_MUSCLES', cached_catalogue)
    monkeypatch.setattr(m.httpx, 'Client', lambda *_a, **_k: pytest.fail('Demo made an upstream request'))
    previous = client.get(f'/api/v1/demo/dashboard/body-map?selected_week={previous_monday}')
    current = client.get(f'/api/v1/demo/dashboard/body-map?selected_week={monday}')
    assert previous.status_code == current.status_code == 200
    chest = next(muscle for muscle in previous.json()['muscles'] if muscle['name'] == 'Chest')
    assert chest['volume'] == expected
    assert chest['intensity'] > 0
    assert next(muscle for muscle in current.json()['muscles'] if muscle['name'] == 'Chest')['volume'] == 250
    empty = client.get(f'/api/v1/demo/dashboard/body-map?selected_week={previous_monday - timedelta(days=7)}')
    assert empty.json()['muscles'] == []
    assert m.WGER_MUSCLES is cached_catalogue

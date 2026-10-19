"""Public training projection. Never authenticate a visitor as the source owner."""
from calendar import monthrange
from datetime import date, timedelta
import os
from threading import Lock
from typing import Literal
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import Session, with_loader_criteria

from . import main as m

router = APIRouter(prefix="/api/v1/demo")
_pool_lock = Lock()
_engine = None
_database_url = None


def demo_enabled():
    return os.getenv("DEMO_ENABLED", "false").lower() == "true" and bool(os.getenv("DEMO_OWNER_EMAIL", "").strip())


class ReadOnlySession(Session):
    def flush(self, objects=None):
        if self.new or self.dirty or self.deleted:
            raise PermissionError("Demo sessions cannot write")


@event.listens_for(ReadOnlySession, "do_orm_execute")
def restrict_demo_queries(state):
    if not state.is_select:
        raise PermissionError("Demo sessions only allow SELECT")
    owner = state.session.info["owner_email"]
    statement = state.statement
    # Independently enforce ownership even if a caller uses skip_tenant_scope.
    for model in m.TENANT_MODELS:
        statement = statement.options(with_loader_criteria(model, lambda cls: cls.owner_email == owner, include_aliases=True))
    statement = statement.options(with_loader_criteria(m.Workout, lambda cls: cls.completed == True, include_aliases=True))
    state.statement = statement


def readonly_engine():
    global _engine, _database_url
    with _pool_lock:
        url = str(m.engine.url)
        if m.engine.dialect.name != "sqlite":
            raise HTTPException(503, "Demo requires a read-only database configuration.")
        if _engine is None or _database_url != url:
            if _engine is not None:
                _engine.dispose()
            _engine = create_engine(m.engine.url, connect_args={"check_same_thread": False})
            _database_url = url

            @event.listens_for(_engine, "connect")
            def query_only(connection, _record):
                connection.execute("PRAGMA query_only=ON")
    return _engine


def demo_db():
    if not demo_enabled():
        raise HTTPException(404, "Demo unavailable.")
    owner = os.environ["DEMO_OWNER_EMAIL"].strip().lower()
    with ReadOnlySession(bind=readonly_engine(), autoflush=False, info={"owner_email": owner}) as db:
        yield db


class PublicModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Exercise(PublicModel):
    id: int
    name: str
    equipment: str
    primary_muscle: str | None
    secondary_muscles: list[str]
    muscle_group: str | None


class RoutineExercise(PublicModel):
    exercise: Exercise
    planned_sets: int
    target_reps: int | None
    target_reps_min: int | None
    target_reps_max: int | None
    target_weight: float | None
    rest_seconds: int


class Routine(PublicModel):
    id: int
    name: str
    folder_id: int | None = None
    exercises: list[RoutineExercise]


class Folder(PublicModel):
    id: int
    name: str
    routines: list[Routine]


class LoggedSet(PublicModel):
    completed: bool = False
    weight: float
    reps: int
    exertion: float | None


class LoggedExercise(PublicModel):
    cached_exercise_id: int | None
    name: str
    primary_muscle: str | None
    secondary_muscles: list[str]
    muscle_group: str | None
    rest_seconds: int
    sets: list[LoggedSet]


class Workout(PublicModel):
    id: int
    name: str
    performed_on: date
    completed: Literal[True] = True
    duration_seconds: int | None
    exercises: list[LoggedExercise]


class PlanDay(PublicModel):
    weekday: int
    routine_id: int
    routine_name: str


class Plan(PublicModel):
    name: str
    starts_on: date
    days: list[PlanDay]


class CalendarDay(PublicModel):
    date: date
    routine_id: int | None
    routine_name: str | None
    routine_override: Routine | None
    status: Literal["completed", "upcoming", "missed", "empty"]
    workout_id: int | None
    workout_name: str | None


class CalendarMonth(PublicModel):
    plan: Plan | None
    days: list[CalendarDay]


class MuscleVolume(PublicModel):
    name: str
    current_week_volume: float
    last_week_volume: float
    current_week_sets: float
    last_week_sets: float


class MuscleSets(PublicModel):
    name: str
    current_week_sets: float
    last_week_sets: float


class Bodyweight(PublicModel):
    recorded_on: date
    weight: float


class Dashboard(PublicModel):
    latest_weight: Bodyweight | None
    weight_series: list[Bodyweight]
    current_sessions: float = 0
    previous_sessions: float = 0
    current_week_start: date
    previous_week_start: date
    total_current_volume: float
    total_previous_volume: float
    volume_by_muscle_group: list[MuscleVolume]
    sets_by_muscle: list[MuscleSets]


class BodyMuscle(PublicModel):
    id: int
    name: str
    volume: float
    intensity: float
    is_front: bool
    image_url: str
    role: Literal["primary", "secondary", "tertiary"]
    is_primary: bool


class BodyMap(PublicModel):
    muscles: list[BodyMuscle]


class ProgressSession(PublicModel):
    workout_id: int
    performed_on: date
    workout_name: str
    sets: list[LoggedSet]
    volume: float
    best_weight: float
    estimated_1rm: float


class Progress(PublicModel):
    exercise: Exercise
    sessions: list[ProgressSession]
    personal_best_weight: float
    personal_best_1rm: float


def public_exercise(item):
    return Exercise(**m.exercise_out(item))


def public_routine(item):
    return Routine(id=item.id, name=item.name, folder_id=item.folder_id, exercises=[RoutineExercise(
        exercise=public_exercise(e.exercise), planned_sets=e.planned_sets, target_reps=e.target_reps,
        target_reps_min=e.target_reps_min or e.target_reps, target_reps_max=e.target_reps_max or e.target_reps,
        target_weight=e.target_weight, rest_seconds=e.rest_seconds,
    ) for e in item.exercises])


def public_workout(item):
    return Workout(id=item.id, name=item.name, performed_on=item.performed_on,
        duration_seconds=int((item.completed_at - item.started_at).total_seconds()) if item.completed_at and item.started_at else None,
        exercises=[LoggedExercise(cached_exercise_id=e.cached_exercise_id, name=e.name,
            primary_muscle=m.canonical_muscle(e.primary_muscle), secondary_muscles=m.stored_secondary_muscles(e.secondary_muscles),
            muscle_group=e.muscle_group, rest_seconds=e.rest_seconds,
            sets=[LoggedSet(weight=s.weight, reps=s.reps, exertion=s.exertion) for s in e.sets]) for e in item.exercises])


@router.get("/folders", response_model=list[Folder])
def folders(db: Session = Depends(demo_db)):
    return [Folder(id=f.id, name=f.name, routines=[public_routine(r) for r in f.routines])
            for f in db.scalars(select(m.RoutineFolder).order_by(m.RoutineFolder.id))]


@router.get("/routines/{routine_id:int}", response_model=Routine)
def routine(routine_id: int, db: Session = Depends(demo_db)):
    item = db.get(m.Routine, routine_id)
    if item is None:
        raise HTTPException(404, "Routine not found")
    return public_routine(item)


@router.get("/workouts", response_model=list[Workout])
def workouts(db: Session = Depends(demo_db)):
    return [public_workout(w) for w in db.scalars(select(m.Workout).order_by(m.Workout.performed_on.desc(), m.Workout.id.desc()))]


def completed_workout(db, workout_id):
    item = db.get(m.Workout, workout_id)
    if item is None:
        raise HTTPException(404, "Workout not found")
    return item


@router.get("/workouts/{workout_id:int}", response_model=Workout)
def workout(workout_id: int, db: Session = Depends(demo_db)):
    return public_workout(completed_workout(db, workout_id))


@router.get("/dashboard", response_model=Dashboard)
def dashboard(selected_week: date | None = None, comparison: Literal['previous', 'average', 'custom'] = 'previous', compare_week: date | None = None, through_today: bool = False, db: Session = Depends(demo_db)):
    data = m.training_dashboard(db, include_bodyweight=True, selected_week=selected_week, comparison=comparison, compare_week=compare_week, through_today=through_today)
    return Dashboard(current_sessions=data["current_sessions"], previous_sessions=data["previous_sessions"], latest_weight=Bodyweight(**data["latest_weight"]) if data["latest_weight"] else None,
        weight_series=[Bodyweight(**entry) for entry in data["weight_series"]],
        current_week_start=data["current_week_start"], previous_week_start=data["previous_week_start"],
        total_current_volume=data["total_current_volume"], total_previous_volume=data["total_previous_volume"],
        volume_by_muscle_group=[MuscleVolume(**v) for v in data["volume_by_muscle_group"]],
        sets_by_muscle=[MuscleSets(**v) for v in data["sets_by_muscle"]])


@router.get("/dashboard/body-map", response_model=BodyMap)
def body_map(selected_week: date | None = None, through_today: bool = False, db: Session = Depends(demo_db)):
    return BodyMap(muscles=[BodyMuscle(**v) for v in m.training_body_map(db, allow_remote=False, selected_week=selected_week, through_today=through_today)["muscles"]
        if urlsplit(v["image_url"]).scheme == "https" and urlsplit(v["image_url"]).netloc == "wger.de"])


def public_plan(item):
    return Plan(name=item.name, starts_on=item.starts_on, days=[PlanDay(weekday=d.weekday,
        routine_id=d.routine_id, routine_name=d.routine.name) for d in item.days if d.routine is not None]) if item else None


@router.get("/calendar/plan", response_model=Plan | None)
def plan(db: Session = Depends(demo_db)):
    return public_plan(db.scalar(select(m.WeeklyPlan).order_by(m.WeeklyPlan.id.desc())))


def public_override(assignment, db):
    if not isinstance(assignment, m.CalendarAssignment) or not assignment.workout_override:
        return None
    import json
    data = json.loads(assignment.workout_override)
    exercises = []
    for e in data["exercises"]:
        exercise = db.get(m.Exercise, e["exercise_id"])
        if exercise is None:
            raise ValueError("Invalid planned exercise")
        exercises.append(RoutineExercise(exercise=public_exercise(exercise), planned_sets=e["planned_sets"],
            target_reps=e.get("target_reps"), target_reps_min=e.get("target_reps_min"),
            target_reps_max=e.get("target_reps_max"), target_weight=e.get("target_weight"), rest_seconds=e.get("rest_seconds", 90)))
    return Routine(id=assignment.routine_id, name=data["name"], exercises=exercises)


@router.get("/calendar", response_model=CalendarMonth)
def calendar(year: int = Query(ge=2000, le=2100), month: int = Query(ge=1, le=12), db: Session = Depends(demo_db)):
    item = db.scalar(select(m.WeeklyPlan).order_by(m.WeeklyPlan.id.desc()))
    first = date(year, month, 1)
    last = date(year, month, monthrange(year, month)[1])
    completed = {w.performed_on: w for w in db.scalars(select(m.Workout).where(m.Workout.performed_on >= first, m.Workout.performed_on <= last))}
    weekly = {d.weekday: d for d in item.days if d.routine is not None} if item else {}
    assignments = {a.day: a for a in db.scalars(select(m.CalendarAssignment).where(m.CalendarAssignment.day >= first, m.CalendarAssignment.day <= last)) if a.routine is not None}
    days = []
    for offset in range(last.day):
        day = first + timedelta(days=offset)
        scheduled = assignments.get(day) or (weekly.get(day.weekday()) if item and day >= item.starts_on else None)
        done = completed.get(day)
        override = public_override(scheduled, db)
        days.append(CalendarDay(date=day, routine_id=scheduled.routine_id if scheduled else None,
            routine_name=override.name if override else scheduled.routine.name if scheduled else None,
            routine_override=override, status="completed" if done else ("upcoming" if day >= date.today() else "missed") if scheduled else "empty",
            workout_id=done.id if done else None, workout_name=done.name if done else None))
    return CalendarMonth(plan=public_plan(item), days=days)


def public_progress(exercise_id, db, exclude_workout_id=None):
    # Do not expose arbitrary entries from the shared custom exercise catalogue.
    referenced = db.scalar(select(m.Workout.id).join(m.WorkoutExercise).where(m.WorkoutExercise.cached_exercise_id == exercise_id).limit(1))
    if referenced is None:
        raise HTTPException(404, "Exercise not found")
    return Progress(**m.exercise_progress(exercise_id, exclude_workout_id, db))


@router.get("/exercises/{exercise_id:int}/progress", response_model=Progress)
def progress(exercise_id: int, exclude_workout_id: int | None = None, db: Session = Depends(demo_db)):
    if exclude_workout_id is not None:
        completed_workout(db, exclude_workout_id)
    return public_progress(exercise_id, db, exclude_workout_id)


@router.get("/workouts/{workout_id:int}/exercise-progress", response_model=dict[str, Progress])
def workout_progress(workout_id: int, db: Session = Depends(demo_db)):
    item = completed_workout(db, workout_id)
    return {str(e.cached_exercise_id): public_progress(e.cached_exercise_id, db, workout_id)
            for e in item.exercises if e.cached_exercise_id is not None}

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, String, create_engine, select, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

DB_PATH = Path(__file__).resolve().parent.parent / "workout_tracker.db"
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False)
WGER_MUSCLES: list[dict] | None = None


class Base(DeclarativeBase):
    pass


class Exercise(Base):
    __tablename__ = "exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    wger_id: Mapped[Optional[str]] = mapped_column(String(80), unique=True, nullable=True)
    name: Mapped[str] = mapped_column(String(180))
    equipment: Mapped[str] = mapped_column(String(100), default="Bodyweight")
    primary_muscle: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    muscle_group: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    secondary_muscles: Mapped[str] = mapped_column(String(300), default="")
    muscle_data_synced: Mapped[bool] = mapped_column(Boolean, default=False)
    search_aliases: Mapped[str] = mapped_column(String(1000), default="")


class RoutineFolder(Base):
    __tablename__ = "routine_folders"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    routines: Mapped[list["Routine"]] = relationship(back_populates="folder", cascade="all, delete-orphan")


class Routine(Base):
    __tablename__ = "routines"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    folder_id: Mapped[Optional[int]] = mapped_column(ForeignKey("routine_folders.id"), nullable=True)
    folder: Mapped[Optional[RoutineFolder]] = relationship(back_populates="routines")
    exercises: Mapped[list["RoutineExercise"]] = relationship(cascade="all, delete-orphan", order_by="RoutineExercise.position")


class RoutineExercise(Base):
    __tablename__ = "routine_exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    routine_id: Mapped[int] = mapped_column(ForeignKey("routines.id"))
    exercise_id: Mapped[int] = mapped_column(ForeignKey("exercises.id"))
    position: Mapped[int] = mapped_column(Integer)
    planned_sets: Mapped[int] = mapped_column(Integer, default=3)
    target_reps: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_reps_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_reps_max: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    target_weight: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rest_seconds: Mapped[int] = mapped_column(Integer, default=90)
    exercise: Mapped[Exercise] = relationship()


class Workout(Base):
    __tablename__ = "workouts"
    id: Mapped[int] = mapped_column(primary_key=True)
    routine_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    performed_on: Mapped[date] = mapped_column(Date, default=date.today)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    started_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    exercises: Mapped[list["WorkoutExercise"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutExercise.position")


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workouts.id"))
    cached_exercise_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(180))
    primary_muscle: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    muscle_group: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    secondary_muscles: Mapped[str] = mapped_column(String(300), default="")
    position: Mapped[int] = mapped_column(Integer)
    note: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)
    rest_seconds: Mapped[int] = mapped_column(Integer, default=90)
    sets: Mapped[list["WorkoutSet"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutSet.position")


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    id: Mapped[int] = mapped_column(primary_key=True)
    workout_exercise_id: Mapped[int] = mapped_column(ForeignKey("workout_exercises.id"))
    position: Mapped[int] = mapped_column(Integer)
    weight: Mapped[float] = mapped_column(Float, default=0)
    reps: Mapped[int] = mapped_column(Integer, default=0)
    exertion: Mapped[Optional[float]] = mapped_column(Float, nullable=True)


class BodyweightEntry(Base):
    __tablename__ = "bodyweight_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    recorded_on: Mapped[date] = mapped_column(Date, unique=True)
    weight: Mapped[float] = mapped_column(Float)


class WeeklyPlan(Base):
    __tablename__ = "weekly_plans"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="My training week")
    starts_on: Mapped[date] = mapped_column(Date)
    days: Mapped[list["WeeklyPlanDay"]] = relationship(cascade="all, delete-orphan", order_by="WeeklyPlanDay.weekday")


class WeeklyPlanDay(Base):
    __tablename__ = "weekly_plan_days"
    id: Mapped[int] = mapped_column(primary_key=True)
    plan_id: Mapped[int] = mapped_column(ForeignKey("weekly_plans.id"))
    weekday: Mapped[int] = mapped_column(Integer)
    routine_id: Mapped[int] = mapped_column(ForeignKey("routines.id"))
    routine: Mapped[Routine] = relationship()


class Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ExerciseOut(Model):
    id: int; name: str; equipment: str; primary_muscle: Optional[str] = None; secondary_muscles: list[str] = []; muscle_group: Optional[str] = None


class ExerciseChoice(BaseModel):
    exercise_id: int; planned_sets: int = Field(ge=1, le=20); target_reps: Optional[int] = Field(None, ge=1, le=100); target_reps_min: Optional[int] = Field(None, ge=1, le=100); target_reps_max: Optional[int] = Field(None, ge=1, le=100); target_weight: Optional[float] = Field(None, ge=0); rest_seconds: int = Field(default=90, ge=0, le=1800)


class CustomExerciseIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    equipment: str = Field(default="Other", max_length=100)
    primary_muscle: Optional[str] = Field(default=None, max_length=80)


class RoutineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); folder_id: Optional[int] = None; exercises: list[ExerciseChoice] = []


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class LoggedSetIn(BaseModel):
    weight: float = Field(ge=0); reps: int = Field(ge=0); exertion: Optional[float] = Field(None, ge=0, le=10)


class WorkoutExerciseIn(BaseModel):
    exercise_id: Optional[int] = None; name: Optional[str] = None; primary_muscle: Optional[str] = None; secondary_muscles: list[str] = []; muscle_group: Optional[str] = None; note: Optional[str] = Field(None, max_length=1000); rest_seconds: int = Field(default=90, ge=0, le=1800); sets: list[LoggedSetIn] = []


class WorkoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); performed_on: date; exercises: list[WorkoutExerciseIn]


class WorkoutDraftIn(BaseModel):
    name: str = Field(default="Workout", min_length=1, max_length=120)
    performed_on: date = Field(default_factory=date.today)


class WeightIn(BaseModel):
    recorded_on: date; weight: float = Field(gt=0, le=500)


class WeeklyPlanDayIn(BaseModel):
    weekday: int = Field(ge=0, le=6)
    routine_id: int


class WeeklyPlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    starts_on: date
    days: list[WeeklyPlanDayIn] = []


MUSCLE_MAP = {
    "quadriceps": "Legs", "hamstrings": "Legs", "calves": "Legs", "glutes": "Legs", "abductors": "Legs", "adductors": "Legs",
    "quads": "Legs", "soleus": "Legs", "lats": "Back", "lower back": "Back", "traps": "Back", "trapezius": "Back", "abdominals": "Core", "abs": "Core", "rectus abdominis": "Core", "obliquus externus abdominis": "Core", "serratus anterior": "Core", "chest": "Chest",
    "shoulders": "Shoulders", "biceps": "Arms", "triceps": "Arms", "brachialis": "Arms", "forearms": "Arms",
}
GROUPS = ["Legs", "Back", "Core", "Chest", "Shoulders", "Arms"]
WGER_GROUP_REGIONS = {
    "Legs": ("Quads", "Hamstrings", "Calves", "Soleus", "Glutes"),
    "Back": ("Lats", "Trapezius"),
    "Core": ("Abs", "Rectus abdominis", "Obliquus externus abdominis", "Serratus anterior"),
    "Chest": ("Chest",),
    "Shoulders": ("Shoulders",),
    "Arms": ("Biceps", "Triceps", "Brachialis"),
}
TERTIARY_MUSCLES = {
    "Chest": ("Shoulders", "Triceps"),
    "Shoulders": ("Triceps", "Trapezius"),
    "Lats": ("Biceps", "Trapezius"),
    "Trapezius": ("Shoulders",),
    "Quads": ("Glutes", "Hamstrings", "Calves"),
    "Hamstrings": ("Glutes", "Calves"),
    "Glutes": ("Hamstrings", "Quads"),
    "Abs": ("Obliquus externus abdominis", "Serratus anterior"),
    "Biceps": ("Brachialis",),
    "Triceps": ("Shoulders",),
}
MUSCLE_ALIASES = {
    "anterior deltoid": "Shoulders", "deltoids": "Shoulders",
    "pectoralis major": "Chest", "pectoralis minor": "Chest",
    "quadriceps": "Quads", "quadriceps femoris": "Quads",
    "biceps brachii": "Biceps", "triceps brachii": "Triceps",
    "latissimus dorsi": "Lats", "gastrocnemius": "Calves",
    "rectus abdominis": "Abs", "abdominals": "Abs",
    "lower back": "Lats", "traps": "Trapezius",
}
EXERCISE_OVERRIDES = {
    # Wger entries whose listed primary muscle is misleading for six-group volume analytics.
    "deadlifts": ("Hamstrings", "Legs"),
    "front squats": ("Quadriceps", "Legs"),
    "bench press narrow grip": ("Chest", "Chest"),
    "dumbbell underhand dead row": ("Lats", "Back"),
    "incline dumbbell row": ("Lats", "Back"),
    "deficit deadlift": ("Hamstrings", "Legs"),
    "low row": ("Lats", "Back"),
}
def get_db():
    db = SessionLocal()
    try: yield db
    finally: db.close()


def group_for(muscle: Optional[str]) -> Optional[str]:
    return MUSCLE_MAP.get((muscle or "").strip().lower())


def canonical_muscle(muscle: Optional[str]) -> str:
    """Turn Wger and legacy stored labels into one predictable muscle key."""
    value = (muscle or "").strip()
    # Old workout rows sometimes contain the display label returned to the UI.
    while value.casefold().startswith("primary:"):
        value = value.split(":", 1)[1].strip()
    value = value.split(" · ", 1)[0].strip()
    return MUSCLE_ALIASES.get(value.casefold(), value)


def stored_secondary_muscles(value: Optional[str]) -> list[str]:
    return [canonical_muscle(name) for name in (value or "").split("|") if canonical_muscle(name)]


def exercise_out(exercise: Exercise) -> dict:
    secondary = [x for x in exercise.secondary_muscles.split("|") if x]
    display = f"Primary: {exercise.primary_muscle or 'Unmapped'}" + (f" · Secondary: {', '.join(secondary)}" if secondary else "")
    return {"id": exercise.id, "name": exercise.name, "equipment": exercise.equipment, "primary_muscle": display, "secondary_muscles": secondary, "muscle_group": exercise.muscle_group}


def routine_out(routine: Routine) -> dict:
    return {"id": routine.id, "name": routine.name, "folder_id": routine.folder_id, "exercises": [{"id": item.id, "position": item.position, "planned_sets": item.planned_sets, "target_reps": item.target_reps, "target_reps_min": item.target_reps_min or item.target_reps, "target_reps_max": item.target_reps_max or item.target_reps, "target_weight": item.target_weight, "rest_seconds": item.rest_seconds, "exercise": exercise_out(item.exercise)} for item in routine.exercises]}


def store_exercise(db: Session, name: str, equipment: str = "Bodyweight", muscle: Optional[str] = None, secondary_muscles: list[str] = [], wger_id: Optional[str] = None, aliases: str = "") -> Exercise:
    corrected_muscle, corrected_group = EXERCISE_OVERRIDES.get(name.strip().lower(), (muscle, group_for(muscle)))
    existing = db.scalar(select(Exercise).where(Exercise.wger_id == wger_id)) if wger_id else db.scalar(select(Exercise).where(Exercise.name.ilike(name)))
    if existing:
        if aliases: existing.search_aliases = aliases
        existing.primary_muscle, existing.muscle_group = corrected_muscle, corrected_group
        existing.secondary_muscles, existing.muscle_data_synced = "|".join(secondary_muscles), True
        return existing
    exercise = Exercise(wger_id=wger_id, name=name, equipment=equipment or "Bodyweight", primary_muscle=corrected_muscle, muscle_group=corrected_group, secondary_muscles="|".join(secondary_muscles), muscle_data_synced=True, search_aliases=aliases)
    db.add(exercise); db.flush(); return exercise


app = FastAPI(title="Workout Tracker API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    # Local development, private-network phones, and temporary Cloudflare preview URLs.
    allow_origin_regex=r"https?://(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2}|[a-z0-9-]+\.trycloudflare\.com)(?::\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def startup():
    Base.metadata.create_all(engine)
    # Lightweight backwards-compatible migration for existing local SQLite files.
    with engine.begin() as connection:
        columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(routine_exercises)")}
        if "target_reps_min" not in columns:
            connection.exec_driver_sql("ALTER TABLE routine_exercises ADD COLUMN target_reps_min INTEGER")
        if "target_reps_max" not in columns:
            connection.exec_driver_sql("ALTER TABLE routine_exercises ADD COLUMN target_reps_max INTEGER")
        if "rest_seconds" not in columns:
            connection.exec_driver_sql("ALTER TABLE routine_exercises ADD COLUMN rest_seconds INTEGER DEFAULT 90")
        exercise_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(exercises)")}
        if "search_aliases" not in exercise_columns:
            connection.exec_driver_sql("ALTER TABLE exercises ADD COLUMN search_aliases VARCHAR(1000) DEFAULT ''")
        if "secondary_muscles" not in exercise_columns:
            connection.exec_driver_sql("ALTER TABLE exercises ADD COLUMN secondary_muscles VARCHAR(300) DEFAULT ''")
        if "muscle_data_synced" not in exercise_columns:
            connection.exec_driver_sql("ALTER TABLE exercises ADD COLUMN muscle_data_synced BOOLEAN DEFAULT 0")
        workout_exercise_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(workout_exercises)")}
        if "note" not in workout_exercise_columns:
            connection.exec_driver_sql("ALTER TABLE workout_exercises ADD COLUMN note VARCHAR(1000)")
        if "rest_seconds" not in workout_exercise_columns:
            connection.exec_driver_sql("ALTER TABLE workout_exercises ADD COLUMN rest_seconds INTEGER DEFAULT 90")
        workout_set_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(workout_sets)")}
        if "exertion" not in workout_set_columns:
            connection.exec_driver_sql("ALTER TABLE workout_sets ADD COLUMN exertion FLOAT")
        workout_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(workouts)")}
        if "started_at" not in workout_columns:
            connection.exec_driver_sql("ALTER TABLE workouts ADD COLUMN started_at DATETIME")
        if "completed_at" not in workout_columns:
            connection.exec_driver_sql("ALTER TABLE workouts ADD COLUMN completed_at DATETIME")
        workout_exercise_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(workout_exercises)")}
        if "secondary_muscles" not in workout_exercise_columns:
            connection.exec_driver_sql("ALTER TABLE workout_exercises ADD COLUMN secondary_muscles VARCHAR(300) DEFAULT ''")
    with SessionLocal() as db:
        for exercise in db.scalars(select(Exercise)).all():
            correction = EXERCISE_OVERRIDES.get(exercise.name.strip().lower())
            if correction:
                exercise.primary_muscle, exercise.muscle_group = correction
        db.commit()


def sync_wger_catalogue(db: Session):
    cached_count = len(list(db.scalars(select(Exercise.id).where(Exercise.wger_id.is_not(None)))))
    needs_muscle_refresh = db.scalar(select(Exercise.id).where(Exercise.wger_id.is_not(None), Exercise.muscle_data_synced == False).limit(1)) is not None
    if cached_count >= 800 and not needs_muscle_refresh:
        return
    with httpx.Client(timeout=12) as client:
        offset = 0
        while True:
            response = client.get("https://wger.de/api/v2/exerciseinfo/", params={"limit": 100, "offset": offset})
            response.raise_for_status(); payload = response.json()
            for item in payload.get("results", []):
                translations = item.get("translations") or []
                english = next((x for x in translations if x.get("language") == 2 and x.get("name")), None)
                chosen = english or next((x for x in translations if x.get("name")), None)
                if not chosen: continue
                aliases = " ".join([x.get("alias", "") for x in chosen.get("aliases", [])] + [x.get("name", "") for x in translations])
                muscles = item.get("muscles") or []
                primary = (muscles[0].get("name_en") or muscles[0].get("name")) if muscles else None
                secondary = [(x.get("name_en") or x.get("name")) for x in item.get("muscles_secondary") or []]
                equipment = (item.get("equipment") or [{}])[0]
                store_exercise(db, chosen["name"], equipment.get("name", "Other") if isinstance(equipment, dict) else str(equipment), primary, secondary, str(item.get("uuid") or item["id"]), aliases)
            db.commit()
            if not payload.get("next"): break
            offset += 100


@app.get("/api/v1/health")
def health(): return {"status": "ok"}


@app.get("/api/v1/exercises", response_model=list[ExerciseOut])
async def search_exercises(q: str = Query(""), db: Session = Depends(get_db)):
    query = q.strip()
    if len(query) >= 2:
        try: sync_wger_catalogue(db)
        except (httpx.HTTPError, ValueError, KeyError, SQLAlchemyError): db.rollback()
    words = [word for word in query.split() if word]
    statement = select(Exercise)
    for word in words:
        statement = statement.where(or_(Exercise.name.ilike(f"%{word}%"), Exercise.search_aliases.ilike(f"%{word}%")))
    normalized = " ".join(words).lower()
    def relevance(exercise: Exercise):
        name = exercise.name.lower()
        aliases = exercise.search_aliases.lower()
        if name == normalized: return (0, len(name))
        if name.startswith(normalized): return (1, len(name))
        if normalized in name: return (2, len(name))
        if any(alias.strip().lower() == normalized for alias in aliases.split(" ")): return (3, len(name))
        return (4, len(name))
    matches = list(db.scalars(statement))
    return [exercise_out(x) for x in sorted(matches, key=relevance)[:12]]


@app.post("/api/v1/exercises/custom", response_model=ExerciseOut)
def create_custom_exercise(payload: CustomExerciseIn, db: Session = Depends(get_db)):
    existing = db.scalar(select(Exercise).where(Exercise.name.ilike(payload.name.strip())))
    exercise = existing or store_exercise(db, payload.name.strip(), payload.equipment, payload.primary_muscle)
    if payload.primary_muscle in GROUPS:
        exercise.primary_muscle = payload.primary_muscle
        exercise.muscle_group = payload.primary_muscle
    db.commit(); db.refresh(exercise)
    return exercise_out(exercise)


@app.delete("/api/v1/exercises/custom/{exercise_id}")
def delete_custom_exercise(exercise_id: int, db: Session = Depends(get_db)):
    exercise = db.get(Exercise, exercise_id)
    if not exercise or exercise.wger_id is not None:
        raise HTTPException(404, "Custom exercise not found")
    db.delete(exercise); db.commit()
    return {"deleted": True}


@app.post("/api/v1/folders")
def create_folder(payload: FolderIn, db: Session = Depends(get_db)):
    folder = RoutineFolder(name=payload.name); db.add(folder); db.commit(); db.refresh(folder); return {"id": folder.id, "name": folder.name, "routines": []}


@app.put("/api/v1/folders/{folder_id}")
def rename_folder(folder_id: int, payload: FolderIn, db: Session = Depends(get_db)):
    folder = db.get(RoutineFolder, folder_id)
    if not folder: raise HTTPException(404, "Folder not found")
    folder.name = payload.name; db.commit(); return {"id": folder.id, "name": folder.name}


@app.delete("/api/v1/folders/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = db.get(RoutineFolder, folder_id)
    if not folder: raise HTTPException(404, "Folder not found")
    db.delete(folder); db.commit(); return {"deleted": True}


@app.get("/api/v1/folders")
def list_folders(db: Session = Depends(get_db)):
    # Existing local catalogues predate secondary-muscle support. Refresh them
    # before returning routines so the builder immediately shows both fields.
    try:
        sync_wger_catalogue(db)
    except (httpx.HTTPError, ValueError, KeyError, SQLAlchemyError):
        db.rollback()
    folders = db.scalars(select(RoutineFolder)).all()
    return [{"id": f.id, "name": f.name, "routines": [routine_out(r) for r in f.routines]} for f in folders]


def populate_routine(routine: Routine, payload: RoutineIn, db: Session):
    routine.name, routine.folder_id = payload.name, payload.folder_id
    routine.exercises.clear()
    for pos, choice in enumerate(payload.exercises):
        if not db.get(Exercise, choice.exercise_id): raise HTTPException(404, "Exercise not found")
        if choice.target_reps_min and choice.target_reps_max and choice.target_reps_min > choice.target_reps_max:
            raise HTTPException(422, "Minimum reps cannot be greater than maximum reps")
        routine.exercises.append(RoutineExercise(exercise_id=choice.exercise_id, position=pos, planned_sets=choice.planned_sets, target_reps=choice.target_reps_min or choice.target_reps, target_reps_min=choice.target_reps_min or choice.target_reps, target_reps_max=choice.target_reps_max or choice.target_reps, target_weight=choice.target_weight, rest_seconds=choice.rest_seconds))


@app.post("/api/v1/routines")
def create_routine(payload: RoutineIn, db: Session = Depends(get_db)):
    if payload.folder_id and not db.get(RoutineFolder, payload.folder_id): raise HTTPException(404, "Folder not found")
    routine = Routine(); populate_routine(routine, payload, db); db.add(routine); db.commit(); db.refresh(routine); return routine_out(routine)


@app.put("/api/v1/routines/{routine_id}")
def update_routine(routine_id: int, payload: RoutineIn, db: Session = Depends(get_db)):
    routine = db.get(Routine, routine_id)
    if not routine: raise HTTPException(404, "Routine not found")
    populate_routine(routine, payload, db); db.commit(); db.refresh(routine); return routine_out(routine)


@app.delete("/api/v1/routines/{routine_id}")
def delete_routine(routine_id: int, db: Session = Depends(get_db)):
    routine = db.get(Routine, routine_id)
    if not routine: raise HTTPException(404, "Routine not found")
    db.delete(routine); db.commit(); return {"deleted": True}


@app.post("/api/v1/routines/{routine_id}/start")
def start_routine(routine_id: int, db: Session = Depends(get_db)):
    routine = db.get(Routine, routine_id)
    if not routine: raise HTTPException(404, "Routine not found")
    workout = Workout(routine_id=routine.id, name=routine.name, performed_on=date.today(), started_at=datetime.utcnow())
    for pos, item in enumerate(routine.exercises):
        workout_exercise = WorkoutExercise(cached_exercise_id=item.exercise.id, name=item.exercise.name, primary_muscle=item.exercise.primary_muscle, secondary_muscles=item.exercise.secondary_muscles, muscle_group=item.exercise.muscle_group, position=pos, rest_seconds=item.rest_seconds)
        workout_exercise.sets = [WorkoutSet(position=i, weight=item.target_weight or 0, reps=item.target_reps_min or item.target_reps or 0) for i in range(item.planned_sets)]
        workout.exercises.append(workout_exercise)
    db.add(workout); db.commit(); return workout_out(workout)


def workout_out(workout: Workout) -> dict:
    # SQLite stores these legacy timestamps without timezone metadata. They are
    # created in UTC, so mark them explicitly before sending them to browsers;
    # otherwise JavaScript interprets a bare ISO datetime as local time.
    def timestamp_out(value: Optional[datetime]) -> Optional[str]:
        if value is None:
            return None
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.isoformat()

    duration_seconds = int((workout.completed_at - workout.started_at).total_seconds()) if workout.started_at and workout.completed_at else None
    def exercise_payload(e: WorkoutExercise):
        secondary = [x for x in e.secondary_muscles.split("|") if x]
        display = f"Primary: {e.primary_muscle or 'Unmapped'}" + (f" · Secondary: {', '.join(secondary)}" if secondary else "")
        return {"id": e.id, "cached_exercise_id": e.cached_exercise_id, "name": e.name, "primary_muscle": display, "secondary_muscles": secondary, "muscle_group": e.muscle_group, "position": e.position, "note": e.note, "rest_seconds": e.rest_seconds, "sets": [{"id": s.id, "weight": s.weight, "reps": s.reps, "exertion": s.exertion, "position": s.position} for s in e.sets]}
    return {"id": workout.id, "name": workout.name, "performed_on": workout.performed_on, "completed": workout.completed, "started_at": timestamp_out(workout.started_at), "completed_at": timestamp_out(workout.completed_at), "duration_seconds": duration_seconds, "exercises": [exercise_payload(e) for e in workout.exercises]}


def populate_workout(workout: Workout, payload: WorkoutIn, db: Session):
    workout.name, workout.performed_on = payload.name, payload.performed_on; workout.exercises.clear()
    for pos, item in enumerate(payload.exercises):
        cached = db.get(Exercise, item.exercise_id) if item.exercise_id else None
        if item.exercise_id and not cached: raise HTTPException(404, "Exercise not found")
        wex = WorkoutExercise(cached_exercise_id=cached.id if cached else None, name=cached.name if cached else (item.name or "Exercise"), primary_muscle=cached.primary_muscle if cached else item.primary_muscle, secondary_muscles=cached.secondary_muscles if cached else "|".join(item.secondary_muscles), muscle_group=cached.muscle_group if cached else (item.muscle_group or group_for(item.primary_muscle)), position=pos, note=item.note, rest_seconds=item.rest_seconds)
        wex.sets = [WorkoutSet(position=i, weight=s.weight, reps=s.reps, exertion=s.exertion) for i, s in enumerate(item.sets)]
        workout.exercises.append(wex)


@app.post("/api/v1/workouts")
def create_workout(payload: WorkoutIn, db: Session = Depends(get_db)):
    now = datetime.utcnow()
    workout = Workout(completed=True, started_at=now, completed_at=now); populate_workout(workout, payload, db); db.add(workout); db.commit(); return workout_out(workout)


@app.post("/api/v1/workouts/draft")
def create_workout_draft(payload: WorkoutDraftIn, db: Session = Depends(get_db)):
    workout = Workout(name=payload.name, performed_on=payload.performed_on, completed=False, started_at=datetime.utcnow())
    db.add(workout); db.commit(); db.refresh(workout)
    return workout_out(workout)


@app.put("/api/v1/workouts/{workout_id}")
def finish_workout(workout_id: int, payload: WorkoutIn, db: Session = Depends(get_db)):
    workout = db.get(Workout, workout_id)
    if not workout: raise HTTPException(404, "Workout not found")
    populate_workout(workout, payload, db); workout.completed = True; workout.completed_at = datetime.utcnow(); db.commit(); return workout_out(workout)


@app.patch("/api/v1/workouts/{workout_id}")
def update_workout(workout_id: int, payload: WorkoutIn, db: Session = Depends(get_db)):
    workout = db.get(Workout, workout_id)
    if not workout: raise HTTPException(404, "Workout not found")
    populate_workout(workout, payload, db)
    db.commit(); db.refresh(workout)
    return workout_out(workout)


@app.delete("/api/v1/workouts/{workout_id}")
def delete_workout(workout_id: int, db: Session = Depends(get_db)):
    workout = db.get(Workout, workout_id)
    if not workout: raise HTTPException(404, "Workout not found")
    db.delete(workout); db.commit()
    return {"deleted": True}


@app.get("/api/v1/workouts")
def list_workouts(db: Session = Depends(get_db)):
    return [workout_out(w) for w in db.scalars(select(Workout).order_by(Workout.completed.asc(), Workout.performed_on.desc(), Workout.created_at.desc())).all()]


@app.get("/api/v1/workouts/active")
def list_active_workouts(db: Session = Depends(get_db)):
    return [workout_out(w) for w in db.scalars(select(Workout).where(Workout.completed == False).order_by(Workout.created_at.desc())).all()]


def weekly_plan_out(plan: WeeklyPlan) -> dict:
    return {"id": plan.id, "name": plan.name, "starts_on": plan.starts_on, "days": [{"weekday": item.weekday, "routine_id": item.routine_id, "routine_name": item.routine.name} for item in plan.days]}


@app.get("/api/v1/calendar/plan")
def get_weekly_plan(db: Session = Depends(get_db)):
    plan = db.scalar(select(WeeklyPlan).order_by(WeeklyPlan.id.desc()))
    return weekly_plan_out(plan) if plan else None


@app.post("/api/v1/calendar/plan")
def save_weekly_plan(payload: WeeklyPlanIn, db: Session = Depends(get_db)):
    if len({item.weekday for item in payload.days}) != len(payload.days):
        raise HTTPException(422, "Each weekday can only have one workout")
    for item in payload.days:
        if not db.get(Routine, item.routine_id): raise HTTPException(404, "Routine not found")
    plan = db.scalar(select(WeeklyPlan).order_by(WeeklyPlan.id.desc()))
    if not plan:
        plan = WeeklyPlan(name=payload.name, starts_on=payload.starts_on); db.add(plan)
    plan.name, plan.starts_on = payload.name, payload.starts_on
    plan.days.clear()
    for item in payload.days:
        plan.days.append(WeeklyPlanDay(weekday=item.weekday, routine_id=item.routine_id))
    db.commit(); db.refresh(plan)
    return weekly_plan_out(plan)


@app.get("/api/v1/calendar")
def calendar_month(year: int = Query(ge=2000, le=2100), month: int = Query(ge=1, le=12), db: Session = Depends(get_db)):
    from calendar import monthrange
    plan = db.scalar(select(WeeklyPlan).order_by(WeeklyPlan.id.desc()))
    first = date(year, month, 1); last = date(year, month, monthrange(year, month)[1])
    completed = {workout.performed_on: workout for workout in db.scalars(select(Workout).where(Workout.completed == True, Workout.performed_on >= first, Workout.performed_on <= last)).all()}
    planned = {item.weekday: item for item in plan.days} if plan else {}
    result = []
    for offset in range((last - first).days + 1):
        day = first + timedelta(days=offset)
        scheduled = planned.get(day.weekday()) if plan and day >= plan.starts_on else None
        workout = completed.get(day)
        result.append({"date": day, "routine_id": scheduled.routine_id if scheduled else None, "routine_name": scheduled.routine.name if scheduled else None, "status": "completed" if workout else ("upcoming" if scheduled and day >= date.today() else ("missed" if scheduled else "empty")), "workout_id": workout.id if workout else None, "workout_name": workout.name if workout else None})
    return {"plan": weekly_plan_out(plan) if plan else None, "days": result}


@app.get("/api/v1/exercises/{exercise_id}/progress")
def exercise_progress(exercise_id: int, exclude_workout_id: Optional[int] = None, db: Session = Depends(get_db)):
    exercise = db.get(Exercise, exercise_id)
    if not exercise: raise HTTPException(404, "Exercise not found")
    rows = []
    workouts = db.scalars(select(Workout).where(Workout.completed == True).order_by(Workout.performed_on.desc())).all()
    for workout in workouts:
        if exclude_workout_id == workout.id: continue
        for item in workout.exercises:
            if item.cached_exercise_id != exercise_id: continue
            sets = [{"weight": s.weight, "reps": s.reps, "exertion": s.exertion} for s in item.sets]
            volume = sum(s["weight"] * s["reps"] for s in sets)
            best_weight = max((s["weight"] for s in sets), default=0)
            estimated_1rm = max((s["weight"] * (1 + s["reps"] / 30) for s in sets if s["reps"] > 0), default=0)
            rows.append({"workout_id": workout.id, "performed_on": workout.performed_on, "workout_name": workout.name, "sets": sets, "volume": volume, "best_weight": best_weight, "estimated_1rm": estimated_1rm})
    return {"exercise": exercise_out(exercise), "sessions": rows, "personal_best_weight": max((x["best_weight"] for x in rows), default=0), "personal_best_1rm": max((x["estimated_1rm"] for x in rows), default=0)}


@app.post("/api/v1/bodyweight")
def save_weight(payload: WeightIn, db: Session = Depends(get_db)):
    entry = db.scalar(select(BodyweightEntry).where(BodyweightEntry.recorded_on == payload.recorded_on))
    if entry: entry.weight = payload.weight
    else: entry = BodyweightEntry(recorded_on=payload.recorded_on, weight=payload.weight); db.add(entry)
    db.commit(); return {"recorded_on": entry.recorded_on, "weight": entry.weight}


@app.get("/api/v1/bodyweight")
def list_weights(db: Session = Depends(get_db)):
    return [{"recorded_on": x.recorded_on, "weight": x.weight} for x in db.scalars(select(BodyweightEntry).order_by(BodyweightEntry.recorded_on)).all()]


@app.get("/api/v1/dashboard")
def dashboard(db: Session = Depends(get_db)):
    today = date.today(); week_start = today - timedelta(days=today.weekday()); previous_start = week_start - timedelta(days=7)
    current = {x: 0.0 for x in GROUPS}; previous = {x: 0.0 for x in GROUPS}
    has_demo = db.scalar(select(Workout.id).where(Workout.name.like("Demo · %")).limit(1)) is not None
    workouts = db.scalars(select(Workout).where(Workout.completed == True, Workout.performed_on >= previous_start)).all()
    for workout in workouts:
        bucket = current if workout.performed_on >= week_start else previous
        for exercise in workout.exercises:
            if exercise.muscle_group in bucket: bucket[exercise.muscle_group] += sum(s.weight * s.reps for s in exercise.sets)
    if has_demo:
        # The demo is meant to illustrate a stable training block: same work,
        # with a small 4% progression in this week rather than a huge swing.
        previous = {group: current[group] / 1.04 for group in GROUPS}
    weights = list_weights(db)
    # Demo mode deliberately uses a fixed 14-point window so older real or
    # earlier demo entries cannot distort the sample trend line.
    if has_demo:
        demo_start = today - timedelta(days=13)
        weights = [entry for entry in weights if entry["recorded_on"] >= demo_start]
    return {"current_week_start": week_start, "previous_week_start": previous_start, "latest_weight": weights[-1] if weights else None, "weight_series": weights, "total_current_volume": sum(current.values()), "total_previous_volume": sum(previous.values()), "volume_by_muscle_group": [{"name": group, "current_week_volume": current[group], "last_week_volume": previous[group]} for group in GROUPS]}


@app.get("/api/v1/dashboard/body-map")
def dashboard_body_map(db: Session = Depends(get_db)):
    """Return this week's Wger overlays from every completed exercise involvement."""
    global WGER_MUSCLES
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    involvement: dict[str, defaultdict[str, float]] = {
        "primary": defaultdict(float),
        "secondary": defaultdict(float),
        "tertiary": defaultdict(float),
    }
    # Some older/demo rows only know a broad group (for example "Legs"). Keep
    # that data useful by spreading it across the Wger regions for that group.
    broad_group_volume: defaultdict[str, float] = defaultdict(float)
    workouts = db.scalars(select(Workout).where(Workout.completed == True, Workout.performed_on >= week_start)).all()
    for workout in workouts:
        for exercise in workout.exercises:
            volume = sum(entry.weight * entry.reps for entry in exercise.sets)
            # A completed bodyweight/zero-load set still trains a muscle. Its
            # reps become the visual score when there is no load volume.
            activation = volume or max(1, sum(entry.reps for entry in exercise.sets))
            cached = db.get(Exercise, exercise.cached_exercise_id) if exercise.cached_exercise_id else None
            source_primary = cached.primary_muscle if cached else exercise.primary_muscle
            source_secondary = cached.secondary_muscles if cached else exercise.secondary_muscles
            source_group = cached.muscle_group if cached else exercise.muscle_group
            primary = canonical_muscle(source_primary)
            secondary = stored_secondary_muscles(source_secondary)
            group = (source_group or group_for(primary) or "").strip().title()

            if primary and primary.casefold() != group.casefold():
                involvement["primary"][primary.casefold()] += activation
            elif group in WGER_GROUP_REGIONS:
                broad_group_volume[group] += activation

            # Wger supplies primary and secondary muscles. Tertiary involvement
            # is a conservative, transparent inference used only to light the map.
            for muscle in secondary:
                involvement["secondary"][muscle.casefold()] += activation * 0.45
            tertiary_sources = [primary, *secondary]
            for source in tertiary_sources:
                targets = TERTIARY_MUSCLES.get(source, ())
                for muscle in targets:
                    if muscle != primary and muscle not in secondary:
                        involvement["tertiary"][muscle.casefold()] += activation * 0.20 / len(targets)
    if WGER_MUSCLES is None:
        try:
            with httpx.Client(timeout=10) as client:
                response = client.get("https://wger.de/api/v2/muscle/", params={"limit": 100})
                response.raise_for_status()
                payload = response.json()
                WGER_MUSCLES = payload.get("results", payload) if isinstance(payload, dict) else payload
        except httpx.HTTPError:
            WGER_MUSCLES = []
    muscles = []
    for muscle in WGER_MUSCLES:
        name = muscle.get("name_en") or muscle.get("name")
        canonical_name = canonical_muscle(name)
        key = canonical_name.casefold()
        primary = involvement["primary"].get(key, 0)
        secondary = involvement["secondary"].get(key, 0)
        tertiary = involvement["tertiary"].get(key, 0)
        group = group_for(canonical_name)
        regions = WGER_GROUP_REGIONS.get(group or "", ())
        broad_primary = broad_group_volume[group] / len(regions) if group and canonical_name in regions and regions else 0
        primary += broad_primary
        volume = primary + secondary + tertiary
        role = "primary" if primary else "secondary" if secondary else "tertiary"
        # Wger provides distinct primary and secondary layer artwork. Inferred
        # tertiary areas deliberately use the subtler secondary artwork.
        image = muscle.get("image_url_main") if role == "primary" else muscle.get("image_url_secondary")
        if image and image.startswith("/"):
            image = f"https://wger.de{image}"
        if volume and image:
            muscles.append({"id": muscle.get("id"), "name": name, "volume": volume, "is_front": muscle.get("is_front", True), "image_url": image, "role": role, "is_primary": role == "primary"})
    peak = max((muscle["volume"] for muscle in muscles), default=0)
    test_mode = db.scalar(select(Workout.id).where(Workout.name.like("Map test · Full body%")).limit(1)) is not None
    return {"muscles": [{**muscle, "intensity": round(muscle["volume"] / peak, 3) if peak else 0} for muscle in muscles], "test_mode": test_mode}


@app.post("/api/v1/dashboard/body-map/test-data")
def create_body_map_test_data(db: Session = Depends(get_db)):
    """Create one clearly labelled, completed session that lights every Wger region."""
    for workout in db.scalars(select(Workout).where(Workout.name.like("Map test · Full body%"))).all():
        db.delete(workout)
    # These are the exact Wger layer names supported by the front/back assets.
    muscles = [
        ("Chest", "Chest"), ("Shoulders", "Shoulders"),
        ("Biceps", "Arms"), ("Triceps", "Arms"), ("Brachialis", "Arms"),
        ("Lats", "Back"), ("Trapezius", "Back"),
        ("Abs", "Core"), ("Rectus abdominis", "Core"),
        ("Obliquus externus abdominis", "Core"), ("Serratus anterior", "Core"),
        ("Quads", "Legs"), ("Hamstrings", "Legs"), ("Glutes", "Legs"),
        ("Calves", "Legs"), ("Soleus", "Legs"),
    ]
    # Ten full-body sessions across 30 days make the analysis graph useful too.
    for session_index, days_ago in enumerate(range(27, -1, -3)):
        workout = Workout(
            name=f"Map test · Full body · {session_index + 1}",
            performed_on=date.today() - timedelta(days=days_ago),
            completed=True,
            started_at=datetime.now(),
            completed_at=datetime.now(),
        )
        for position, (muscle, group) in enumerate(muscles):
            item = WorkoutExercise(name=f"Map test · {muscle}", primary_muscle=muscle, muscle_group=group, position=position)
            item.sets = [WorkoutSet(position=0, weight=20 + session_index * 2, reps=8 + (position % 4), exertion=7)]
            workout.exercises.append(item)
        db.add(workout)
    db.commit()
    return {"created": len(muscles) * 10}


@app.delete("/api/v1/dashboard/body-map/test-data")
def delete_body_map_test_data(db: Session = Depends(get_db)):
    for workout in db.scalars(select(Workout).where(Workout.name.like("Map test · Full body%"))).all():
        db.delete(workout)
    db.commit()
    return {"deleted": True}


@app.post("/api/v1/demo-data")
def create_demo_data(db: Session = Depends(get_db)):
    """Add repeatable sample history without touching a user's real entries."""
    for workout in db.scalars(select(Workout).where(Workout.name.like("Demo · %"))).all():
        db.delete(workout)

    today = date.today()
    current_week_start = today - timedelta(days=today.weekday())
    # A conservative gain phase for an 80 kg lifter: ~0.28 kg over 14 days,
    # with small daily water-weight fluctuations instead of a perfectly straight line.
    demo_weights = [80.00, 80.05, 80.03, 80.08, 80.07, 80.11, 80.10, 80.15, 80.13, 80.18, 80.17, 80.22, 80.20, 80.28]
    # One entry for every calendar day in the two-week demo window.
    for index, days_ago in enumerate(range(13, -1, -1)):
        logged_on = today - timedelta(days=days_ago)
        entry = db.scalar(select(BodyweightEntry).where(BodyweightEntry.recorded_on == logged_on))
        if entry: entry.weight = demo_weights[index]
        else: db.add(BodyweightEntry(recorded_on=logged_on, weight=demo_weights[index]))

    sessions = [
        (13, "Demo · Upper", [("Bench press", "Chest", 70, 9, 4), ("Seated Cable Row", "Back", 55, 10, 4), ("Lateral raise", "Shoulders", 10, 14, 3), ("Cable curl", "Arms", 18, 12, 3)]),
        (11, "Demo · Lower", [("Back squat", "Legs", 85, 8, 4), ("Romanian deadlift", "Legs", 75, 9, 3), ("Cable crunch", "Core", 30, 14, 3)]),
        (8, "Demo · Upper", [("Incline dumbbell press", "Chest", 26, 10, 4), ("Lat pulldown", "Back", 55, 10, 4), ("Shoulder press", "Shoulders", 32, 9, 3), ("Tricep pressdown", "Arms", 25, 12, 3)]),
        (6, "Demo · Lower", [("Leg press", "Legs", 150, 11, 4), ("Leg curl", "Legs", 45, 12, 3), ("Plank", "Core", 0, 1, 3)]),
        (3, "Demo · Pull", [("Seated Cable Row", "Back", 60, 10, 4), ("Lat pulldown", "Back", 60, 9, 3), ("Rear delt fly", "Shoulders", 18, 14, 3), ("Hammer curl", "Arms", 16, 11, 3)]),
        (2, "Demo · Lower", [("Back squat", "Legs", 90, 7, 4), ("Romanian deadlift", "Legs", 80, 8, 3), ("Cable crunch", "Core", 32, 14, 3)]),
        (1, "Demo · Push", [("Bench press", "Chest", 72.5, 8, 4), ("Shoulder press", "Shoulders", 35, 8, 3), ("Cable fly", "Chest", 20, 13, 3), ("Tricep pressdown", "Arms", 27.5, 11, 3)]),
        (0, "Demo · Full body", [("Back squat", "Legs", 92.5, 8, 4), ("Romanian deadlift", "Legs", 82.5, 10, 3), ("Seated Cable Row", "Back", 62.5, 10, 4), ("Lat pulldown", "Back", 57.5, 10, 3), ("Dumbbell bench press", "Chest", 30, 10, 3), ("Lateral raise", "Shoulders", 12, 15, 3), ("Cable curl", "Arms", 22.5, 12, 3), ("Cable crunch", "Core", 35, 14, 3)]),
    ]
    for days_ago, name, exercises in sessions:
        performed = today - timedelta(days=days_ago)
        started = datetime.combine(performed, datetime.min.time()).replace(hour=17, minute=30)
        # Keep the same program structure while making the current week a
        # modest, believable progression over the preceding week.
        load_multiplier = .72 if performed < current_week_start else 1
        workout = Workout(name=name, performed_on=performed, completed=True, started_at=started, completed_at=started + timedelta(minutes=58))
        for position, (exercise_name, group, weight, reps, set_count) in enumerate(exercises):
            exercise = WorkoutExercise(name=exercise_name, primary_muscle=group, muscle_group=group, position=position)
            exercise.sets = [WorkoutSet(position=set_index, weight=round(weight * load_multiplier, 1), reps=reps + (1 if set_index == 0 else 0), exertion=7.5 + (set_index * .5)) for set_index in range(set_count)]
            workout.exercises.append(exercise)
        db.add(workout)
    db.commit()
    return {"created": len(sessions), "message": "Two weeks of demo training added"}

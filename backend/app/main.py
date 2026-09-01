from __future__ import annotations

from datetime import date, datetime, timedelta
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
    exercise: Mapped[Exercise] = relationship()


class Workout(Base):
    __tablename__ = "workouts"
    id: Mapped[int] = mapped_column(primary_key=True)
    routine_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    performed_on: Mapped[date] = mapped_column(Date, default=date.today)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    exercises: Mapped[list["WorkoutExercise"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutExercise.position")


class WorkoutExercise(Base):
    __tablename__ = "workout_exercises"
    id: Mapped[int] = mapped_column(primary_key=True)
    workout_id: Mapped[int] = mapped_column(ForeignKey("workouts.id"))
    cached_exercise_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[str] = mapped_column(String(180))
    primary_muscle: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    muscle_group: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    position: Mapped[int] = mapped_column(Integer)
    sets: Mapped[list["WorkoutSet"]] = relationship(cascade="all, delete-orphan", order_by="WorkoutSet.position")


class WorkoutSet(Base):
    __tablename__ = "workout_sets"
    id: Mapped[int] = mapped_column(primary_key=True)
    workout_exercise_id: Mapped[int] = mapped_column(ForeignKey("workout_exercises.id"))
    position: Mapped[int] = mapped_column(Integer)
    weight: Mapped[float] = mapped_column(Float, default=0)
    reps: Mapped[int] = mapped_column(Integer, default=0)


class BodyweightEntry(Base):
    __tablename__ = "bodyweight_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    recorded_on: Mapped[date] = mapped_column(Date, unique=True)
    weight: Mapped[float] = mapped_column(Float)


class Model(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class ExerciseOut(Model):
    id: int; name: str; equipment: str; primary_muscle: Optional[str] = None; muscle_group: Optional[str] = None


class ExerciseChoice(BaseModel):
    exercise_id: int; planned_sets: int = Field(ge=1, le=20); target_reps: Optional[int] = Field(None, ge=1, le=100); target_reps_min: Optional[int] = Field(None, ge=1, le=100); target_reps_max: Optional[int] = Field(None, ge=1, le=100); target_weight: Optional[float] = Field(None, ge=0)


class CustomExerciseIn(BaseModel):
    name: str = Field(min_length=2, max_length=180)
    equipment: str = Field(default="Other", max_length=100)
    primary_muscle: Optional[str] = Field(default=None, max_length=80)


class RoutineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); folder_id: Optional[int] = None; exercises: list[ExerciseChoice] = []


class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)


class LoggedSetIn(BaseModel):
    weight: float = Field(ge=0); reps: int = Field(ge=0)


class WorkoutExerciseIn(BaseModel):
    exercise_id: Optional[int] = None; name: Optional[str] = None; primary_muscle: Optional[str] = None; muscle_group: Optional[str] = None; sets: list[LoggedSetIn] = []


class WorkoutIn(BaseModel):
    name: str = Field(min_length=1, max_length=120); performed_on: date; exercises: list[WorkoutExerciseIn]


class WeightIn(BaseModel):
    recorded_on: date; weight: float = Field(gt=0, le=500)


MUSCLE_MAP = {
    "quadriceps": "Legs", "hamstrings": "Legs", "calves": "Legs", "glutes": "Legs", "abductors": "Legs", "adductors": "Legs",
    "lats": "Back", "lower back": "Back", "traps": "Back", "abdominals": "Core", "chest": "Chest",
    "shoulders": "Shoulders", "biceps": "Arms", "triceps": "Arms", "forearms": "Arms",
}
GROUPS = ["Legs", "Back", "Core", "Chest", "Shoulders", "Arms"]
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


def exercise_out(exercise: Exercise) -> dict:
    return {"id": exercise.id, "name": exercise.name, "equipment": exercise.equipment, "primary_muscle": exercise.primary_muscle, "muscle_group": exercise.muscle_group}


def routine_out(routine: Routine) -> dict:
    return {"id": routine.id, "name": routine.name, "folder_id": routine.folder_id, "exercises": [{"id": item.id, "position": item.position, "planned_sets": item.planned_sets, "target_reps": item.target_reps, "target_reps_min": item.target_reps_min or item.target_reps, "target_reps_max": item.target_reps_max or item.target_reps, "target_weight": item.target_weight, "exercise": exercise_out(item.exercise)} for item in routine.exercises]}


def store_exercise(db: Session, name: str, equipment: str = "Bodyweight", muscle: Optional[str] = None, wger_id: Optional[str] = None, aliases: str = "") -> Exercise:
    corrected_muscle, corrected_group = EXERCISE_OVERRIDES.get(name.strip().lower(), (muscle, group_for(muscle)))
    existing = db.scalar(select(Exercise).where(Exercise.wger_id == wger_id)) if wger_id else db.scalar(select(Exercise).where(Exercise.name.ilike(name)))
    if existing:
        if aliases: existing.search_aliases = aliases
        existing.primary_muscle, existing.muscle_group = corrected_muscle, corrected_group
        return existing
    exercise = Exercise(wger_id=wger_id, name=name, equipment=equipment or "Bodyweight", primary_muscle=corrected_muscle, muscle_group=corrected_group, search_aliases=aliases)
    db.add(exercise); db.flush(); return exercise


app = FastAPI(title="Workout Tracker API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


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
        exercise_columns = {row[1] for row in connection.exec_driver_sql("PRAGMA table_info(exercises)")}
        if "search_aliases" not in exercise_columns:
            connection.exec_driver_sql("ALTER TABLE exercises ADD COLUMN search_aliases VARCHAR(1000) DEFAULT ''")
    with SessionLocal() as db:
        for exercise in db.scalars(select(Exercise)).all():
            correction = EXERCISE_OVERRIDES.get(exercise.name.strip().lower())
            if correction:
                exercise.primary_muscle, exercise.muscle_group = correction
        db.commit()


def sync_wger_catalogue(db: Session):
    cached_count = len(list(db.scalars(select(Exercise.id).where(Exercise.wger_id.is_not(None)))))
    if cached_count >= 800:
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
                equipment = (item.get("equipment") or [{}])[0]
                store_exercise(db, chosen["name"], equipment.get("name", "Other") if isinstance(equipment, dict) else str(equipment), primary, str(item.get("uuid") or item["id"]), aliases)
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
    folders = db.scalars(select(RoutineFolder)).all()
    return [{"id": f.id, "name": f.name, "routines": [routine_out(r) for r in f.routines]} for f in folders]


def populate_routine(routine: Routine, payload: RoutineIn, db: Session):
    routine.name, routine.folder_id = payload.name, payload.folder_id
    routine.exercises.clear()
    for pos, choice in enumerate(payload.exercises):
        if not db.get(Exercise, choice.exercise_id): raise HTTPException(404, "Exercise not found")
        if choice.target_reps_min and choice.target_reps_max and choice.target_reps_min > choice.target_reps_max:
            raise HTTPException(422, "Minimum reps cannot be greater than maximum reps")
        routine.exercises.append(RoutineExercise(exercise_id=choice.exercise_id, position=pos, planned_sets=choice.planned_sets, target_reps=choice.target_reps_min or choice.target_reps, target_reps_min=choice.target_reps_min or choice.target_reps, target_reps_max=choice.target_reps_max or choice.target_reps, target_weight=choice.target_weight))


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
    workout = Workout(routine_id=routine.id, name=routine.name, performed_on=date.today())
    for pos, item in enumerate(routine.exercises):
        workout_exercise = WorkoutExercise(cached_exercise_id=item.exercise.id, name=item.exercise.name, primary_muscle=item.exercise.primary_muscle, muscle_group=item.exercise.muscle_group, position=pos)
        workout_exercise.sets = [WorkoutSet(position=i, weight=item.target_weight or 0, reps=item.target_reps_min or item.target_reps or 0) for i in range(item.planned_sets)]
        workout.exercises.append(workout_exercise)
    db.add(workout); db.commit(); return workout_out(workout)


def workout_out(workout: Workout) -> dict:
    return {"id": workout.id, "name": workout.name, "performed_on": workout.performed_on, "completed": workout.completed, "exercises": [{"id": e.id, "cached_exercise_id": e.cached_exercise_id, "name": e.name, "primary_muscle": e.primary_muscle, "muscle_group": e.muscle_group, "position": e.position, "sets": [{"id": s.id, "weight": s.weight, "reps": s.reps, "position": s.position} for s in e.sets]} for e in workout.exercises]}


def populate_workout(workout: Workout, payload: WorkoutIn, db: Session):
    workout.name, workout.performed_on = payload.name, payload.performed_on; workout.exercises.clear()
    for pos, item in enumerate(payload.exercises):
        cached = db.get(Exercise, item.exercise_id) if item.exercise_id else None
        if item.exercise_id and not cached: raise HTTPException(404, "Exercise not found")
        wex = WorkoutExercise(cached_exercise_id=cached.id if cached else None, name=cached.name if cached else (item.name or "Exercise"), primary_muscle=cached.primary_muscle if cached else item.primary_muscle, muscle_group=cached.muscle_group if cached else (item.muscle_group or group_for(item.primary_muscle)), position=pos)
        wex.sets = [WorkoutSet(position=i, weight=s.weight, reps=s.reps) for i, s in enumerate(item.sets)]
        workout.exercises.append(wex)


@app.post("/api/v1/workouts")
def create_workout(payload: WorkoutIn, db: Session = Depends(get_db)):
    workout = Workout(completed=True); populate_workout(workout, payload, db); db.add(workout); db.commit(); return workout_out(workout)


@app.put("/api/v1/workouts/{workout_id}")
def finish_workout(workout_id: int, payload: WorkoutIn, db: Session = Depends(get_db)):
    workout = db.get(Workout, workout_id)
    if not workout: raise HTTPException(404, "Workout not found")
    populate_workout(workout, payload, db); workout.completed = True; db.commit(); return workout_out(workout)


@app.get("/api/v1/workouts")
def list_workouts(db: Session = Depends(get_db)):
    return [workout_out(w) for w in db.scalars(select(Workout).where(Workout.completed == True).order_by(Workout.performed_on.desc())).all()]


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
    workouts = db.scalars(select(Workout).where(Workout.completed == True, Workout.performed_on >= previous_start)).all()
    for workout in workouts:
        bucket = current if workout.performed_on >= week_start else previous
        for exercise in workout.exercises:
            if exercise.muscle_group in bucket: bucket[exercise.muscle_group] += sum(s.weight * s.reps for s in exercise.sets)
    weights = list_weights(db)
    return {"current_week_start": week_start, "previous_week_start": previous_start, "latest_weight": weights[-1] if weights else None, "weight_series": weights, "total_current_volume": sum(current.values()), "total_previous_volume": sum(previous.values()), "volume_by_muscle_group": [{"name": group, "current_week_volume": current[group], "last_week_volume": previous[group]} for group in GROUPS]}

# Workout Tracker

A local, Hevy-inspired workout tracker with routines, editable workout sessions, bodyweight logging, weekly muscle-group volume analytics, and Wger-powered exercise search.

## Run the app

Start the API from the `backend` folder after installing its requirements:

```text
fastapi dev app/main.py
```

The server runs at `http://localhost:8000` and creates `backend/workout_tracker.db` automatically. Then, in a separate terminal at the project root, run:

```text
npm run dev
```

The Vite interface is available at `http://localhost:5173`.

## Notes

- SQLite stores one local user’s routines, workout history, and bodyweight entries.
- Weekly volume is weight × reps, using Monday–Sunday weeks.
- Volume is counted once against each exercise’s primary mapped muscle group: legs, back, core, chest, shoulders, or arms.
- Exercise search is performed by FastAPI against Wger and cached locally. A small fallback catalogue is seeded for offline use.

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
# W-Tracker

## Run on your Wi-Fi

Start the API in one terminal:

```powershell
cd backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Then start the frontend in another:

```powershell
npm run dev -- --host
```

Open the Network address Vite prints on your phone. The app will now automatically call the API on the same computer, using port 8000.

## Deploying

The frontend needs a reachable FastAPI deployment; Vite only serves the interface. Set `VITE_API_URL` to the deployed API's `/api/v1` address before building the frontend. Copy `.env.example` to `.env` and replace the example URL.

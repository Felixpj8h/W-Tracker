# Workout Tracker

A local, Hevy-inspired workout tracker with routines, editable workout sessions, bodyweight logging, weekly muscle-group volume analytics, and Wger-powered exercise search.

## Run the app

Install the backend requirements:

```powershell
cd C:\Users\felix\Desktop\Projects\W-Tracker\backend
python -m pip install -r requirements.txt
```

### Configure the AI coach

The AI coach uses Google's Gemini API. Copy `.env.example` to `.env`, then add
your Gemini API key. The `.env` file is ignored by Git and must not be
committed.

```powershell
cd C:\Users\felix\Desktop\Projects\W-Tracker
Copy-Item .env.example .env
```

Edit `.env` so it contains:

```dotenv
GEMINI_API_KEY=your_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

The backend reads these settings from its process environment. Before starting
it directly with Uvicorn, load them from the project-level `.env` file:

```powershell
cd C:\Users\felix\Desktop\Projects\W-Tracker\backend
$env:GEMINI_API_KEY = ((Get-Content ..\.env | Where-Object { $_ -match '^GEMINI_API_KEY=' }) -split '=', 2)[1].Trim()
$env:GEMINI_MODEL = ((Get-Content ..\.env | Where-Object { $_ -match '^GEMINI_MODEL=' }) -split '=', 2)[1].Trim()
```

If you use Uvicorn directly, first change into `backend`. Running the command from another folder (such as `C:\\Windows\\System32`) causes `ModuleNotFoundError: No module named 'app'`:

```powershell
cd C:\Users\felix\Desktop\Projects\W-Tracker\backend
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

The server runs at `http://localhost:8000` and creates
`backend/workout_tracker.db` automatically. Then, in a separate terminal at
the project root, run:

```text
npm run dev
```

The Vite interface is available at `http://localhost:5173`.

Coach failures are written to `backend/logs/coach.log`. The chat shows an error
reference that you can search for in this file. Logs rotate at 2 MB and keep
three older files. The log folder is ignored by Git.

### Port 8000 is already in use

If Uvicorn reports `WinError 10048`, another process is already listening on
port 8000. Find it with:

```powershell
Get-NetTCPConnection -LocalPort 8000 -State Listen |
  Select-Object LocalAddress, LocalPort, OwningProcess
```

If it is an old backend process, stop it using the displayed process ID:

```powershell
Stop-Process -Id <OwningProcess>
```

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
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Then start the frontend in another:

```powershell
npm run dev -- --host
```

Open the Network address Vite prints on your phone. The app will now automatically call the API on the same computer, using port 8000.

## Deploying

The frontend needs a reachable FastAPI deployment; Vite only serves the interface. Set `VITE_API_URL` to the deployed API's `/api/v1` address before building the frontend. Copy `.env.example` to `.env` and replace the example URL.

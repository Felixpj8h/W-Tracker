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

### Configure Google sign-in

Create a Google OAuth client with application type **Web application**. Add
`http://localhost:5173` (and each deployed frontend URL) under **Authorized
JavaScript origins**, then configure the same client ID for the frontend and
backend:

```dotenv
VITE_GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
ALLOWED_EMAILS=you@example.com
SESSION_SECRET=your_long_random_secret
```

`ALLOWED_EMAILS` accepts a comma-separated list. The API verifies every Google
ID token and rejects accounts outside this allowlist. `/api/v1/health` remains
public for deployment health checks.

`SESSION_SECRET` signs browser-session cookies. Use a unique random value and
keep it stable across backend restarts. The cookie is shared by app tabs and
expires when the browser session ends or after 24 hours, whichever comes first.

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

## Production deployment (Docker/VPS)

The production stack serves the frontend and API from one HTTPS origin. Nginx
serves the Vite build on `127.0.0.1:8080` and proxies `/api/v1` to a single
FastAPI worker. Put a TLS terminator such as Caddy, Traefik, or Cloudflare in
front of port 8080; do not expose the backend container directly.

1. Copy `.env.example` to `.env` and set `PUBLIC_ORIGIN` and
   `ALLOWED_ORIGINS` to the exact public HTTPS origin, without a trailing slash.
2. Set the same Google Web client ID in `GOOGLE_CLIENT_ID` and
   `VITE_GOOGLE_CLIENT_ID`. Add the public origin to Google's authorized
   JavaScript origins.
3. Set `ALLOWED_EMAILS` to the comma-separated accounts that may sign in, plus
   `GEMINI_API_KEY`. Never commit `.env`.
4. Run `docker compose up --build -d`, then check
   `https://your-domain.example/healthz`.

The first backend start runs `alembic upgrade head` against the named
`workout_data` volume. SQLite is intentionally limited to one Uvicorn worker;
move to PostgreSQL before adding backend replicas.

### Upgrades, backups, and recovery

Before an upgrade, stop writes and copy `/data/workout_tracker.db` from the
`workout_data` volume to encrypted backup storage. Then pull the new release
and run `docker compose up --build -d`; migrations run before the API starts.
To recover, stop the stack, restore the database file into the volume, and
start the stack again. Keep backup access restricted because the database
contains workout, bodyweight, and coach-conversation data.

### Dependency locks and checks

Production Python dependencies are hash-pinned in
`backend/requirements.lock`; development and audit tools are pinned in
`backend/requirements-dev.lock`. Regenerate them on Linux/Python 3.12 with:

```text
uv pip compile backend/requirements.in --generate-hashes --python-version 3.12 --python-platform x86_64-manylinux_2_28 --output-file backend/requirements.lock
uv pip compile backend/requirements-dev.in --generate-hashes --python-version 3.12 --python-platform x86_64-manylinux_2_28 --output-file backend/requirements-dev.lock
```

CI runs frontend tests, lint, production builds, npm and Python vulnerability
audits, backend tests, migrations, and both container builds.

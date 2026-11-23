# Deploy Jern on Railway

Jern runs on Railway as two services built from this repository's Dockerfiles:

- **Frontend**: public Nginx service built from the root `Dockerfile`. It serves the
  React app and forwards `/api/v1` to the backend over Railway's private network.
- **Backend**: private FastAPI service built from `backend/Dockerfile`, with a
  volume at `/data` for the SQLite database.

The production project is `W-Tracker`, with the services `Frontend`
(`https://workout.felixjohannessen.no`) and `Backend` (volume `backend-volume`
at `/data`). Railway reference variables such as `${{Backend.…}}` use these
service names.

## Deploy

1. Push the repository to GitHub. Do not commit `.env`, database files or logs.
2. In a Railway project, add two services from the repository:
   - `Backend`: set **Root Directory** to `/backend` so Railway builds
     `backend/Dockerfile`. Do not generate a public domain for it.
   - `Frontend`: leave the root directory at `/` so Railway builds the root
     `Dockerfile`.
3. On `Backend`, attach a volume with mount path `/data`.
4. Set the backend variables:

   | Variable | Value |
   | --- | --- |
   | `APP_ENV` | `production` (also the default when unset) |
   | `DATABASE_URL` | `sqlite:////data/workout_tracker.db` |
   | `PUBLIC_ORIGIN` | `https://workout.felixjohannessen.no` |
   | `ALLOWED_ORIGINS` | `https://workout.felixjohannessen.no` |
   | `GOOGLE_CLIENT_ID` | your Google Web OAuth client ID |
   | `ALLOWED_EMAILS` | comma-separated Google accounts allowed to sign in |
   | `ENABLE_API_DOCS` | `false` |
   | `TRUSTED_PROXY_IPS` | the `Frontend` service's private network addresses (see [Client addresses](#client-addresses)) |
   | `GEMINI_API_KEY`, `GEMINI_MODEL` | Coach settings |
   | `TYPESAFE_API_KEY`, `TYPESAFE_MODEL`, `TYPESAFE_SAFE_MAX`, `TYPESAFE_BLOCK_MIN`, `TYPESAFE_TOPIC_MIN` | Coach screening; see [policy details](coach-topic-policy.md) |
   | `GOOGLE_HEALTH_*` | optional; see [Google Health](google-health.md) |
   | `DEMO_ENABLED`, `DEMO_OWNER_EMAIL` | optional public demo |

5. Set the `Frontend` variables:

   | Variable | Value |
   | --- | --- |
   | `PORT` | `8080`, the port Nginx listens on |
   | `BACKEND_ADDRESS` | `${{Backend.RAILWAY_PRIVATE_DOMAIN}}:8000` |
   | `VITE_GOOGLE_CLIENT_ID` | `${{Backend.GOOGLE_CLIENT_ID}}` |
   | `VITE_API_URL` | `/api/v1` |
   | `TRUSTED_EDGE_HEADER` | `X-Real-IP` |
   | `TRUSTED_EDGE_CIDR` | Railway's edge proxy network (see [Client addresses](#client-addresses)) |

   Railway passes service variables to the Docker build as build arguments, so
   `VITE_GOOGLE_CLIENT_ID` is baked into the JavaScript bundle. Redeploy `Frontend`
   after changing it. Backend secrets belong only on `Backend`, and your local
   `.env` is never uploaded.
6. On `Frontend`, set the health check path to `/healthz`, then add the custom domain
   `workout.felixjohannessen.no` under **Settings > Networking** and create the
   DNS record Railway shows. Change only the `workout` record.
7. In Google OAuth's **Authorized JavaScript origins**, add
   `https://workout.felixjohannessen.no` (no path or trailing slash).
8. Open `https://workout.felixjohannessen.no/healthz` and expect
   `{"status":"ok"}`. Then check sign-in, routines, workout saving, bodyweight
   and the Coach. Redeploy the backend and confirm the data is still there.

## How deploys and migrations work

`docker build` never touches the database. When a new backend deployment
starts, its container runs `alembic upgrade head` against `/data` and only then
starts a single Uvicorn worker. If a migration fails, the backend does not
start and the site shows errors until you fix it or roll back.

Keep one backend replica: SQLite and the in-memory rate limits assume a single
process. A service with a volume stops its old deployment before starting the
new one, so expect a short outage on every backend deploy.

## Back up and restore

Back up before every deploy that adds a migration in `backend/alembic/versions`.

**Railway's Backups tab.** On the Hobby plan this tab can only view, restore
and delete backups that already exist. Creating backups, schedules and
point-in-time recovery need the Pro plan. Without Pro, use the copies below.

**Download a verified copy to your computer.** Run this from the repository:

```powershell
.\scripts\backup-railway.ps1
```

It copies the database in memory inside the running backend with SQLite's
backup API, which is safe while the app is writing, and streams it over
`railway ssh`. Before keeping the file it checks the SHA-256 fingerprint,
SQLite's integrity check and the migration version. It writes nothing to the
volume. Backups go to `Documents\Jern backups` by default (`-OutDir` changes
this), outside the repository so they cannot be committed or copied into a
Docker image. They contain every account's training data, so keep them private.

One-time setup: install the Railway CLI (`npm i -g @railway/cli`), run
`railway login` and `railway link` (project `W-Tracker`, environment
`production`, service `Backend`), and create a separate SSH key for Railway:

```powershell
ssh-keygen -t ed25519 -f $env:USERPROFILE\.ssh\id_ed25519_railway -C railway-jern
railway ssh keys add -k $env:USERPROFILE\.ssh\id_ed25519_railway.pub
```

The script uses `id_ed25519_railway` automatically. Give it a passphrase: the
key opens a shell in production, with access to the whole database. The script
asks for the passphrase on each run.

**Restoring needs a file on the volume.** To restore, the backup must be at a
path such as `/data/backup-YYYYMMDD-HHMM.db`. You can make one before deploying
in the backend's **Console** tab (or `railway ssh`):

```sh
python -c "
import sqlite3, datetime
name = '/data/backup-' + datetime.datetime.now().strftime('%Y%m%d-%H%M') + '.db'
src = sqlite3.connect('/data/workout_tracker.db'); dst = sqlite3.connect(name)
src.backup(dst); dst.close(); src.close(); print(name)
"
```

Delete old copies now and then: the volume also holds the live database.

**Restore.** Old code cannot start on a database migrated past the versions it
knows, so restore the data first:

1. In the backend's **Console** (or `railway ssh`), copy the backup into the live
   database with the backup API:

   ```sh
   python -c "
   import sqlite3
   src = sqlite3.connect('/data/backup-YYYYMMDD-HHMM.db'); dst = sqlite3.connect('/data/workout_tracker.db')
   src.backup(dst); dst.close(); src.close()
   "
   ```

2. Redeploy the backend's previous deployment from its **Deployments** list.
3. Check `/healthz` and sign-in.

Workouts logged after the backup are lost, so back up immediately before
deploying. Never delete the volume when redeploying.

## Client addresses

Rate limits use the visitor's IP address, which reaches the backend through two
proxies: Railway's edge, then Nginx in `Frontend`.

- On `Frontend`, Nginx trusts `TRUSTED_EDGE_HEADER` (`X-Real-IP`, the header Railway
  sets) only from `TRUSTED_EDGE_CIDR`, then overwrites `X-Forwarded-For`.
- On `Backend`, Uvicorn trusts forwarding headers only from `TRUSTED_PROXY_IPS`.

The defaults trust only `127.0.0.1`. Then every visitor appears to share one
address, so one busy client can use up the sign-in limit for everyone. Set both
values to the addresses Railway actually uses for your project, and verify
them in the deploy logs before relying on per-client limits. See
[Railway's networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits).

## Troubleshooting

- **502 from `/api` or `/healthz`:** check the backend's deploy logs for a
  failed migration or startup error first. Then check that `BACKEND_ADDRESS`
  points at the backend's private domain and port `8000`. If the environment's
  private network is IPv6-only, make the backend listen on `::` instead of
  `0.0.0.0` (start command in `backend/Dockerfile`).
- **Database permission error:** the backend runs as UID `10001`, and Railway
  mounts volumes as root. If the backend cannot write to `/data`, set
  `RAILWAY_RUN_UID=0` on `Backend`. Never move the database off the volume.
- **Failed sign-in:** check both client IDs, the authorized JavaScript origins
  and `ALLOWED_EMAILS`. Failed writes with a signed-in session: check
  `PUBLIC_ORIGIN` and `ALLOWED_ORIGINS`.
- **The backend refuses to start with an `APP_ENV` error:** it accepts only
  `development` or `production`.

References: [Dockerfiles on Railway](https://docs.railway.com/guides/dockerfiles),
[variables](https://docs.railway.com/guides/variables),
[private networking](https://docs.railway.com/guides/private-networking),
[volumes](https://docs.railway.com/guides/volumes) and
[public domains](https://docs.railway.com/guides/public-networking).

# Deploy W-Tracker on Render

The root `render.yaml` creates two new Docker services in Frankfurt:

- `w-tracker-web`: public Nginx service serving React and proxying `/api/v1`.
- `w-tracker-backend`: private FastAPI service with a 1 GB disk at `/data`.

Both use paid Starter plans; review Render's current pricing before creating
the Blueprint. This deployment does not modify your existing main static site.
Render provides HTTPS for `workout.felixjohannessen.no`.

## Deploy

1. Push the repository, including `render.yaml`, to your connected Git provider.
   Do not commit `.env`, database files, or logs.
2. In Render, choose **New > Blueprint**, select this repository and branch, and
   review the two services and disk before creating them.
3. Supply the prompted backend values:
   - `GOOGLE_CLIENT_ID`: your Google Web OAuth client ID.
   - `ALLOWED_EMAILS`: comma-separated Google accounts allowed to use the app.
   - `GEMINI_API_KEY`: your Gemini API key.
   - `GEMINI_MODEL`: the model ID you use in your local configuration.
4. Render generates `SESSION_SECRET` once and copies the Google client ID to
   the frontend build. Backend credentials belong only on the backend service.
   Your local `.env` is not uploaded or automatically read by Render.
5. Wait for both services to deploy. On the web service, open **Settings >
   Custom Domains** and follow Render's DNS instructions for
   `workout.felixjohannessen.no`. Change only the `workout` DNS record; keep the
   main domain's existing records. Wait for domain verification and HTTPS.
6. In Google OAuth's **Authorized JavaScript origins**, add
   `https://workout.felixjohannessen.no` (no path or trailing slash).
7. Open `https://workout.felixjohannessen.no/healthz`; expect `{"status":"ok"}`.
   Then verify sign-in, routines, workout saving, bodyweight, and the coach.
   Restart the backend and confirm saved data remains.

The Render URL can be used for a health check before DNS is ready. For full
sign-in testing at that URL, also add its exact HTTPS origin to Google OAuth
and to the backend's comma-separated `ALLOWED_ORIGINS`. Keep `PUBLIC_ORIGIN`
set to the custom domain.

## How networking and storage work

Render injects the backend's private `hostport` into the web service as
`BACKEND_ADDRESS`. Nginx substitutes it at startup, leaving the browser API URL
at `/api/v1`. HTTPS forwarding is preserved through Nginx to FastAPI. There is
no public backend URL and no Caddy setup.

The backend runs migrations before starting its single Uvicorn worker. SQLite
is stored at `/data/workout_tracker.db`; other container files are ephemeral.
Keep one backend instance. Local Docker volumes are not transferred to Render;
the deployment starts with an empty database. Use a separate, validated import
if you want to preserve local history.

Back up the database before schema upgrades and test recovery. Stop writes
before copying SQLite files, or use SQLite's online backup API. Never delete
the disk when redeploying. Disk-backed deployments can have downtime.

## Updates and troubleshooting

- Rebuild/redeploy the frontend after changing the Google client ID because
  `VITE_GOOGLE_CLIENT_ID` is baked into the JavaScript build. Blueprint sync
  refreshes cross-service environment references.
- Preserve the generated session secret across deployments.
- A failed `/healthz` check: inspect backend migration/startup logs first, then
  web logs and `BACKEND_ADDRESS`. Both services must share a region.
- A database permission error: verify that `/data` is writable by the backend's
  UID/GID `10001:10001`; do not switch to an ephemeral database location.
- Failed sign-in: check client IDs, authorized JavaScript origins, and the
  email allowlist. Failed cookie-authenticated writes: check allowed origins.

References: [Blueprint specification](https://render.com/docs/blueprint-spec),
[Docker on Render](https://render.com/docs/docker),
[persistent disks](https://render.com/docs/disks), and
[custom domains](https://render.com/docs/custom-domains).

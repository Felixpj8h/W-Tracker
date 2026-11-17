# Google Health integration

The Health page uses the Google Health v4 REST API, independently of Jern's
Google sign-in. No provider tokens or OAuth secrets are sent to the frontend.
Google Fit and the Android-only Health Connect SDK are not used.

## Setup

1. Enable the **Google Health API** in a Google Cloud project. Create an OAuth
   **Web application** client and configure its consent screen. Add test users
   if the application is in testing, and complete Google's required verification
   before making the integration broadly available.
2. Register the exact backend callback as an authorized redirect URI:
   `https://your-jern-host/api/v1/health/google/callback`.
   For local Vite development use
   `http://localhost:5173/api/v1/health/google/callback` (through Vite's API proxy).
   The redirect returns to the callback's origin at `/?health=connected#health`.
   Deploy the frontend and this callback on the same origin.
3. Set these **backend** environment variables:

   | Variable | Value |
   | --- | --- |
   | `GOOGLE_HEALTH_CLIENT_ID` | Web OAuth client ID |
   | `GOOGLE_HEALTH_CLIENT_SECRET` | Its client secret |
   | `GOOGLE_HEALTH_REDIRECT_URI` | Exact callback registered above |
   | `GOOGLE_HEALTH_TOKEN_KEY` | A stable Fernet encryption key |

   Generate the key with your backend Python environment:

   ```powershell
   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
   ```

   Store the key with deployment secrets and keep it across restarts. Replacing
   it prevents old tokens from being decrypted; affected users must disconnect
   and reconnect. Never use a `VITE_` variable for these secrets.
   Copy the complete generated key, including the trailing `=`. The callback
   variable is required even when the client ID and secret are already set.
   Restart the backend after changing `.env`; refreshing the page alone does
   not reload the backend's environment.
4. Run `alembic upgrade head` from `backend` before starting production. Local
   development creates the new tables with the existing startup process.
5. Open **Health**, connect, and authorize access using the same Google account
   as your Jern sign-in. In explicit local development, the built-in local
   account can connect your own Google account. The Google account must be
   linked to Google Health; sync a supported wearable in Google Health first.

The requested scopes are `openid`, `email`, and:

```text
https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly
https://www.googleapis.com/auth/googlehealth.sleep.readonly
https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly
```

Consent can be partial. Use **Connection & permissions → Update permissions**
to add missing categories. Jern never requests health write access.

## Data and behavior

- Steps and active minutes use reconciled daily rollups, preventing duplicate
  device records from being added together. Active minutes include light,
  moderate and vigorous activity, rather than weighted active-zone minutes.
- Exercise, sleep, daily HRV and resting heart rate use reconciled streams with
  pagination. Sleep uses the wake date and the principal session for each day;
  naps are not added to the overnight trend. Missing stages remain unavailable.
- Seven civil days are selected using the browser's current local date. Provider
  civil dates retain wearable day boundaries; sleep times display in the browser's
  timezone. Recovery readings always show their measurement date.
- A private seven-day summary is cached per Jern account. Opening Health fetches
  data when the cache is more than five minutes old; **Sync now** fetches on demand.
  It does not force the watch itself to sync. Partial failures are labelled;
  missing records show `—`, not zero. A complete failure retains the old cache
  and its original fetch timestamp. Sync requests are limited to six per minute.
- Recovery shows metrics and short-term comparisons when at least three prior
  readings exist. Jern does not manufacture a readiness score. **Ask coach about
  recovery** explicitly shares the dated summary in a new coach conversation,
  requesting advice only through the existing screened AI flow. Plan proposals
  still require the user's confirmation.
- Tokens are encrypted at rest. Summaries are account-private database rows and
  are excluded from the public demo. Disconnect deletes the local connection,
  summary and pending OAuth attempts and attempts to revoke Google access.
  If Google is unavailable or the encryption key was lost, remove the app's
  access in your Google account settings too. Summaries previously sent to the
  coach remain in those conversations until the conversations are deleted.

## Verification limits

Automated tests use synthetic provider responses and temporary databases. Live
OAuth, wearable coverage and Google project approval require the configured
project and a consenting account. A local implementation is not a deployment.

## Official references

- [Google Health setup](https://developers.google.com/health/setup)
- [Scopes](https://developers.google.com/health/scopes)
- [Daily rollups](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/dailyRollUp)
- [Reconciliation](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/reconcile)
- [Data schemas](https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints)

# Changelog

## 12 November 2026

- Allow questions about the coach's capabilities, supported topics and usage by
  meaning, including contextual follow-ups after refusals; align Gemini's prompt
  and add evaluation cases while retaining coding and mixed-request restrictions.
- Remove temporary classifier terminal prints and the phone-preview category
  watcher after debugging; retain structured diagnostic file logging.
- Include the safe classifier failure reason in terminal debug output so a missing
  SDK or configuration issue can be distinguished from a topic classification.
- Show backend category output live in the phone-preview terminal instead of
  leaving redirected debug prints visible only in its log file.
- Print the detected Jev category to the backend terminal for debugging, without
  chat content or secrets; print `unavailable` when classification fails.
- Add independent TypeSafe Jev input/output topic checks before coach replies or
  model-directed tools are released, with clarification for uncertainty and logged
  degraded enforcement on technical failures (fail open).
- Buffer and screen generated tool arguments and conversation summaries; add
  backend-only classifier settings, policy tests and an optional synthetic live evaluation.
- Ignore the root `AGENTS.md` file so repository instructions stay local.

## 1.0 — 11 November 2026

### Security fixes — 11 November 2026

These changes have been implemented and verified locally. Railway proxy
configuration and production deployment are pending.

### Versioning and maintenance

- Establish version 1.0 as the changelog baseline and set the package version to 1.0.0.
- Require a changelog update with every future repository change. Record changes
  under Unreleased until a version is assigned.

| Issue | What solved it |
| --- | --- |
| The next account could see the previous user's workout draft. | Drafts are stored per account. Ownership is verified before restoration, and old saves are stopped when accounts change. |
| A copied login cookie worked after logout. | Sessions are tracked in the database and revoked on logout, invalidating copied cookies. |
| An old autosave could overwrite a finished workout. | Workout revisions reject outdated saves. Draft saves cannot change completed workouts. |
| A coach proposal could run twice. | Confirmation and rejection compete for one atomic database transition, allowing one action to win. |
| Forged IP headers could bypass the demo rate limit. | Forwarding headers are accepted only from configured trusted proxies, and Nginx replaces visitor-supplied values. Railway's actual trusted addresses still require configuration. |
| Demo history became increasingly expensive to load. | History loads in pages, exercises and sets load in batches, and progress calculations use bounded queries. |
| A routine could be moved into another account's folder. | The API and database enforce folder ownership. The migration repairs existing invalid links while preserving routine contents. |
| Origin checks could trust a forged hostname. | Cookie-authenticated writes require an explicitly approved origin. Missing, hostile, and lookalike origins are rejected. |
| Dependencies had reported vulnerabilities. | Compatible patched versions were installed and locked. Both dependency audits passed. |

### Related reliability fixes

- Preserve acknowledged workout revisions during later edits and background saves.
- Keep unsynced local input available when a server revision conflict occurs,
  with an option to reload the saved workout.
- Advance workout revisions when moving completed workouts in the calendar.
- Offer a retry when server logout cannot be confirmed.
- Keep demo history search filters independent of dashboard activity.
- Load calendar workout details even when they fall outside the loaded history page.
- Preserve Unicode case-insensitive search and prevent duplicate history rows
  when loading more results.
- Add the real Nginx/Uvicorn security checks to CI.

### Upgrade notes

- Users must sign in again after upgrading.
- The legacy shared browser draft cache is removed because its owner cannot be
  established. Unsynced edits held only in that cache may be lost. Server-saved
  active workouts remain resumable.
- Database migration `0006_security_boundaries` is required. Back up the database
  and deploy the frontend and backend together.
- Demo charts describe loaded sessions. Session and volume totals cover the full
  filtered history. Demo exercise progress covers the latest 100 completed workouts.

### Verification

- 148 frontend tests passed.
- 92 backend tests passed in Linux/Python 3.12.
- Production builds and container configuration checks passed.
- Real Nginx/Uvicorn tests passed session revocation and forwarded-IP protections.
- Both dependency audits passed. Lint completed successfully with warnings.
- Real mobile devices and production release checks remain pending.

See the [security remediation report](docs/security-remediation.md) for migration,
proxy configuration, verification details, and recovery instructions.

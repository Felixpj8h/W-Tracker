# Security remediation

This release replaces browser cookies with opaque, revocable database sessions,
isolates cached drafts by account, requires workout revisions, and serializes
coach proposal decisions with conditional database updates.

## Compatibility

- Existing browser cookies require a fresh Google sign-in after upgrading.
- The shared legacy workout cache is removed because its owner is unknown.
  Server-saved active sessions remain available. Unsynced legacy browser edits
  may be lost.
- Workout PUT/PATCH requests require the revision returned by the API. Missing
  or stale revisions return 409. Draft saves cannot update completed workouts.
  Intentional edits send `intent: "edit"` with the current revision.
- Logout and cookie-authenticated writes require an explicitly trusted Origin.
  Production requires PUBLIC_ORIGIN to be an HTTPS origin without a path.
- Public history returns items, next_cursor, months, total_sessions and
  total_volume. Its default page size is 25 and its maximum is 100. Search and
  month filtering run against the full published history. Demo chart points
  describe loaded sessions, as labeled, while session and volume totals are
  calculated on the server over the complete matching history. Exercise
  progress is limited to the latest 100 completed workouts.

## Proxy configuration

The owner confirmed that Railway hosts the public service. The Render
blueprint remains an alternative deployment configuration.

Set TRUSTED_EDGE_HEADER to X-Real-IP for Railway, which documents that header
as its client-address header. Configure TRUSTED_EDGE_CIDR on the web service
with the verified ingress proxy network. Nginx accepts forwarding information only from that network, then
overwrites X-Forwarded-For with its resolved client address. Configure
TRUSTED_PROXY_IPS on the backend with the verified Nginx peer IPs or networks.
Keep the backend reachable only from the web service.

Both settings default to loopback. Until the actual chain is configured,
forwarding information is ignored and visitors behind the same proxy share a
rate-limit bucket. Verify that distinct clients resolve separately and that
changing a visitor-supplied header cannot escape an exhausted bucket. Verify
HTTPS forwarding and Nginx's own limiter in the complete deployment stack.

## Release and recovery

1. Stop writes and take a consistent, encrypted SQLite backup. Record the
   current frontend/backend image versions and configuration.
2. On a disposable restored backup, run `alembic upgrade head` and verify the
   repaired routine-folder associations and workout values.
3. Configure explicit public origins and verified proxy peers. Deploy the
   backend and frontend together, keeping writes paused until migrations finish.
4. Verify sign-in, logout cookie revocation, draft resume, finishing and editing
   workouts, calendar/history notes, coach confirmation/rejection, and demo
   pagination. Watch authentication failures, conflicts, rate limits and errors.
5. To roll back, pause writes, restore the pre-upgrade database and prior images
   and configuration together, and verify health and sign-in before reopening.
   Restoring the backup discards writes made after it was taken. Prefer backup
   restoration over an in-place schema downgrade for recovery.

The migration preserves routine contents and ownership while detaching folder
references that point to a missing folder or a folder belonging to another user.
SQLite triggers enforce the association independently of ORM validation.

## Verification

| Finding | Regression coverage |
| --- | --- |
| Drafts crossing account boundaries | Account-scoped cache tests, logout generation guards, and intercepted browser checks in desktop Chromium 157 and Firefox 153, Android Chromium 157 and iOS WebKit 26.5 |
| Session replay after logout | Full API tests for copied cookies, expiry, allowlist removal and fresh database connections |
| Stale workout saves | API tests for missing/stale revisions, completed-workout draft rejection, intentional edits, and concurrent saves |
| Duplicate coach operations | Independent database sessions synchronized before concurrent confirm/confirm and confirm/reject claims |
| Forwarded IP spoofing | Real Nginx/Uvicorn container tests prove trusted ingress sanitization, distinct client buckets, and rejection of forged identity headers from untrusted peers |
| Public history/progress growth | Pagination, full-history filtering and aggregate totals, duplicate-free cursors, and SQL-count limits with 135 additional workouts |
| Foreign routine folders | API rejection, direct SQL trigger rejection, and migration repair preserving routine contents |
| Origin trust | Rejection of forged matching Host/Origin, missing Origin, null Origin and origin lookalikes |
| Dependency advisories | npm audit and pip-audit pass against the refreshed lockfiles |

The final frontend suite passes 148 tests. The complete backend suite passes
92 tests in the Linux/Python 3.12 container. A disposable migration probe also
passed fresh installation, downgrade and re-upgrade, legacy workout preservation,
folder-reference repair and SQL guards.

Both production images build, Nginx starts on a read-only filesystem, and the
actual Nginx/Uvicorn stack passes the forwarding and revocation checks below.
Real mobile devices and production deployment remain pending release checks.

## Resumed verification

Docker Desktop was started and both production images built successfully. The
complete backend suite passed 92 tests inside Linux/Python 3.12 with the locked
dependencies. The real Nginx/Uvicorn stack passed cookie revocation, separate
trusted client identities, sanitization of spoofed forwarded addresses, and
rejection of forged client addresses from untrusted peers. These checks use an
internal Docker network, synthetic identities and disposable databases. The
reusable runner is scripts/check_security_stack.py and the container CI job
now runs it after building the production images.

Review also corrected preservation of acknowledged draft revisions during later
unsynced edits. Restoring an owned draft at a stale revision preserves local
input and exposes the conflict instead of silently replacing that input.

Railway's header contract is documented in its public networking specifications.
Production peer addresses and CIDRs still require verification in the Railway
project before changing its configuration or deploying.
[Railway networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits)

## Initial handoff — 11 November 2026

Paused at the user's request after completing the current verification work.
Changes are saved and uncommitted on main, based on commit 16e24fa. No production
deployment or production database migration was performed.

All local remediation changes are implemented. The build succeeds and lint exits
successfully with warnings. The frontend full-suite run passed 143 tests, followed
by 54 lifecycle tests that include one new background-save regression. The
Python 3.12 full-suite run passed 91 tests. The final calendar revision check and
two public-history/progress boundary checks also passed. Those two final public
checks ran on the installed Python 3.14 runtime after the temporary 3.12 runtime
was removed. Both dependency audits reported no known vulnerabilities.

The final public-progress guard preserves the original restriction to exercise
IDs explicitly linked by the published workout. Matching an unlinked exercise
name against the shared catalogue must not publish additional catalogue data.

Disposable databases, dependency tools, runtimes and downloaded browser engines
have been removed. The actual application database was not migrated during tests.

When resuming, inspect the working tree and this report first. Finish reviewing
the changes, then verify the actual hosting proxy peers and complete Docker and
release checks. Coordinate the frontend/backend release with the backup and
migration procedure above. Demo analysis charts currently describe loaded pages,
while server totals cover the full filtered history. Real-device verification
remains pending.


## Local completion after resuming

The owner requested local work only. Production configuration, deployment and
the live database remain untouched. The changes are saved and uncommitted.

Additional review regressions cover retaining acknowledged revisions during
later local edits, preserving stale local input for explicit conflict resolution,
keeping demo history filters independent of dashboard activity, and opening
calendar details outside the currently loaded history page. Demo search retains
Unicode case-insensitive matching, and weekly activity uses bounded week-specific
queries. The container runner is part of CI for future changes.

Before production release, obtain the verified Railway ingress and backend peer
addresses, back up the database, then follow the coordinated release procedure.
The local jern-security-web and jern-security-backend images are
verification artifacts. The web image uses a synthetic Google client ID. Build
the release image with the real deployment configuration when deploying.

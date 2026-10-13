# Demo mode safety review

Reviewed 13 October 2026 against the current local working tree, including the
uncommitted demo implementation. Application source and deployment settings
were not changed by this review.

The anonymous demo's data isolation and write protections passed the checks.
Two availability issues should be addressed before enabling public access.

## Findings

### P2: Forwarded IP spoofing bypasses the application rate limit

Locations: `backend/Dockerfile:20`, `nginx.conf:31`,
`backend/app/main.py:678`.

The backend starts Uvicorn with `--forwarded-allow-ips=*`. Nginx forwards
`$proxy_add_x_forwarded_for`, preserving any address supplied by the visitor.
Uvicorn's trust-all setting selects the first forwarded address as
`request.client.host`, which the demo uses for its 120-reads-per-minute bucket.
A visitor can select a new bucket by changing that address.

Reproduced locally with the installed Uvicorn `ProxyHeadersMiddleware`, using
the same trust-all setting and a header representing Nginx's appended peer:

- Exhaust the bucket for `198.51.100.20`.
- `X-Forwarded-For: 198.51.100.20` returns **429**.
- `X-Forwarded-For: 203.0.113.45, 198.51.100.20` returns **200**.

The existing test for spoofed forwarded headers uses FastAPI's test client
directly, without Uvicorn's proxy middleware, so it misses this deployment
behavior. Nginx's independent request limit still applies; the reproduction
establishes bypass of the application limit, not of every deployment limit.

Fix: establish the trusted proxy chain, discard visitor-supplied forwarded IP
values at its ingress, and configure Uvicorn to trust only that chain. Add a
regression test that wraps the app in the deployed proxy middleware and proves
that changing the visitor's header cannot escape an exhausted bucket.

### P2: Public history requests have unbounded database work

Locations: `backend/app/demo.py:249`, `backend/app/demo.py:328`,
`backend/app/demo.py:344`, `src/features/demo/DemoApp.tsx:63`.

The public workouts endpoint returns all completed workouts. Serializing each
workout lazily loads its exercises and then their sets. A temporary fixture
with 51 completed workouts and one exercise per workout performed **103 SQL
statements for one GET**. No pagination or history window bounds this work.
The demo reloads the entire history when navigating between pages or months.
The per-workout progress endpoint also calls the full-history progress
calculation separately for each exercise.

As history grows, anonymous requests become increasingly expensive and can
compete with the private workspace for resources, particularly when combined
with the rate-limit bypass above. This was a query-count probe, not a production
load test or a demonstrated service outage.

Fix: bound public history with pagination or a documented date window, load
relationships in batches, and batch the workout progress calculation. Avoid
reloading unchanged full history on every demo navigation. Add a regression
test that verifies bounded query growth with a realistically sized history.

## Protections verified

- Demo publication defaults to disabled; missing owner configuration fails
  closed.
- Reads use the configured owner, including nested calendar relationships.
  Other-account IDs, unfinished workout IDs, and unused catalogue exercise IDs
  are rejected. Changing the configured owner does not reuse the prior owner's
  data.
- Explicit public projections exclude bodyweight, notes, account emails,
  unfinished workouts, and coach conversations. Demo reads do not query
  bodyweight or conversation tables.
- Unsupported mutation methods are rejected. SQLite query-only connections
  reject writes, and the demo session rejects ORM mutation attempts.
- Anonymous private API access and the authenticated demo-data creation route
  remain protected. Encoded path traversal and misleading demo-like prefixes
  did not bypass authentication.
- Frontend demo requests are GET-only, omit credentials and authorization,
  preserve saved private drafts, and do not expose editing controls.
- Demo reads do not refresh the upstream catalogue or invoke the coach. Body
  map URLs are limited to HTTPS images on `wger.de`.
- Demo responses use `Cache-Control: no-store`; an existing authenticated
  session remains unchanged by demo reads.

## Publication scope

This is a live projection of the selected account's training. Routine and
exercise names, completed training, loads/reps/RPE, dates, durations, and future
calendar plans are intentionally public. Future edits to those fields become
public automatically, including personal information typed into their names.
There is no per-record publication approval. Disabling the demo stops new
reads but cannot retract copies already obtained.

## Validation and limits

- Frontend: **45 tests passed**, including all five demo tests.
- Backend: **56 tests passed**, including all 16 demo cases.
- Three additional temporary audit probes passed, confirming the two findings
  and the owner/path isolation checks described above.
- Production frontend build passed. Lint completed with warnings and no errors.
- Backend checks used installed local Python 3.14 dependencies. The deployment
  uses Python 3.12 and its locked requirements; that container was not run.
- Initial sandbox test attempts failed on temporary-file permissions or stalled
  on Windows event-loop sockets. Frontend tests then passed with workspace
  temporary files, and backend tests passed outside the sandbox. Stalled audit
  processes were stopped.
- No deployed service, live account data, or production traffic was tested.
  These results cover local code and simulated proxy behavior.

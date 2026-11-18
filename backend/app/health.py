"""Read-only Google Health v4 integration. No provider tokens leave the backend."""
from __future__ import annotations

import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
import os
import secrets
import time
from urllib.parse import urlencode, urlsplit

from cryptography.fernet import Fernet, InvalidToken
import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from . import main as m

router = APIRouter(prefix="/api/v1/health", tags=["health"])
BASE = "https://health.googleapis.com/v4/users/me"
SCOPE_PREFIX = "https://www.googleapis.com/auth/googlehealth."
SCOPES = {"activity": SCOPE_PREFIX + "activity_and_fitness.readonly",
          "sleep": SCOPE_PREFIX + "sleep.readonly",
          "recovery": SCOPE_PREFIX + "health_metrics_and_measurements.readonly"}
COOKIE = "jern_health_oauth"
CALLBACK_PATH = "/api/v1/health/google/callback"
STEP_ROLLUP_DAYS = 90


def cipher():
    try:
        return Fernet(os.getenv("GOOGLE_HEALTH_TOKEN_KEY", "").encode())
    except (ValueError, TypeError) as error:
        raise HTTPException(503, "Google Health token encryption is not configured.") from error


def config():
    values = tuple(os.getenv(key, "").strip() for key in
                   ("GOOGLE_HEALTH_CLIENT_ID", "GOOGLE_HEALTH_CLIENT_SECRET", "GOOGLE_HEALTH_REDIRECT_URI"))
    parsed = urlsplit(values[2])
    local = m.APP_ENV == "development" and parsed.hostname in {"localhost", "127.0.0.1"}
    if not all(values) or parsed.path != CALLBACK_PATH or parsed.query or parsed.fragment or parsed.username or parsed.password or not parsed.hostname or (parsed.scheme != "https" and not (local and parsed.scheme == "http")):
        raise HTTPException(503, "Google Health is not configured on the server.")
    cipher()
    return values


def configured():
    try:
        config()
        return True
    except HTTPException:
        return False


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def connection(db):
    # Explicit predicate also protects callers outside request-scoped sessions.
    return db.scalar(select(m.HealthConnection).where(m.HealthConnection.owner_email == db.info["owner_email"]))


def unpack(item):
    try:
        return json.loads(cipher().decrypt(item.tokens.encode()))
    except (InvalidToken, ValueError) as error:
        raise HTTPException(503, "Cannot unlock Google Health connection. Check the server token key.") from error


def pack(tokens):
    return cipher().encrypt(json.dumps(tokens).encode()).decode()


def provider_request(client, method, url, **kwargs):
    try:
        response = client.request(method, url, **kwargs)
    except httpx.HTTPError as error:
        raise HTTPException(502, "Google Health could not be reached. Try again.") from error
    if response.status_code == 401:
        raise HTTPException(409, "Reconnect Google Health to renew access.")
    if response.status_code == 403:
        raise HTTPException(403, "Google Health access denied. Check granted permissions and API access.")
    if not response.is_success:
        if url == "https://oauth2.googleapis.com/token":
            try:
                if response.json().get("error") == "invalid_grant":
                    raise HTTPException(409, "Reconnect Google Health to renew access.")
            except ValueError:
                pass
        raise HTTPException(502, "Google Health could not complete the request. Try again.")
    try:
        return response.json()
    except ValueError as error:
        raise HTTPException(502, "Google Health returned an unreadable response.") from error


def access_token(db, item, client):
    tokens = unpack(item)
    if tokens.get("expires_at", 0) <= time.time() + 60:
        client_id, secret, _ = config()
        payload = provider_request(client, "POST", "https://oauth2.googleapis.com/token", data={
            "grant_type": "refresh_token", "refresh_token": tokens["refresh_token"],
            "client_id": client_id, "client_secret": secret})
        tokens.update(access_token=payload["access_token"], expires_at=int(time.time()) + int(payload.get("expires_in", 3600)))
        if payload.get("refresh_token"):
            tokens["refresh_token"] = payload["refresh_token"]
        item.tokens = pack(tokens)
        db.commit()
    return tokens["access_token"]


@router.get("/overview")
def overview(db: Session = Depends(m.get_db)):
    item = connection(db)
    return output(item)


def output(item):
    data = json.loads(item.snapshot) if item and item.snapshot != "{}" else None
    history = data.pop("step_history", None) if data is not None else None
    step_totals = None
    if history is not None and SCOPES["activity"] in item.scopes.split():
        counts = history["days"].values()
        step_totals = {"total_steps": sum(counts), "goal_days": sum(steps >= item.step_goal for steps in counts)}
    return {"configured": configured(), "connected": item is not None,
            "account_email": item.account_email if item else None,
            "permissions": {key: bool(item and value in item.scopes.split()) for key, value in SCOPES.items()},
            "step_goal": item.step_goal if item else 8000,
            "fetched_at": item.fetched_at if item else None,
            "step_totals": step_totals, "data": data}


@router.post("/google/connect")
def connect(db: Session = Depends(m.get_db)):
    client_id, _, redirect = config()
    state, browser, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    db.execute(delete(m.HealthOAuthAttempt).where(m.HealthOAuthAttempt.owner_email == db.info["owner_email"]))
    db.add(m.HealthOAuthAttempt(state_hash=digest(state), browser_hash=digest(browser), verifier=verifier,
                               expires=int(time.time()) + 600))
    db.commit()
    params = {"client_id": client_id, "redirect_uri": redirect, "response_type": "code",
              "access_type": "offline", "prompt": "consent", "state": state,
              "scope": "openid email " + " ".join(SCOPES.values()),
              "code_challenge": challenge, "code_challenge_method": "S256"}
    result = JSONResponse({"url": "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params), "saved": True})
    result.set_cookie(COOKIE, browser, max_age=600, httponly=True, secure=m.APP_ENV == "production", samesite="lax", path=CALLBACK_PATH)
    result.headers["Cache-Control"] = "no-store"
    return result


@router.get("/google/callback")
def callback(request: Request, state: str = "", code: str = "", error: str = ""):
    # The browser nonce and single-use state bind the callback to the initiating account.
    with m.SessionLocal() as db:
        attempt = db.scalar(select(m.HealthOAuthAttempt).where(m.HealthOAuthAttempt.state_hash == digest(state)).execution_options(skip_tenant_scope=True))
        browser = request.cookies.get(COOKIE, "")
        if not attempt or attempt.expires < time.time() or not browser or not secrets.compare_digest(attempt.browser_hash, digest(browser)):
            raise HTTPException(400, "Google Health connection expired or invalid. Start again from Health.")
        owner, verifier = attempt.owner_email, attempt.verifier
        consumed = db.execute(delete(m.HealthOAuthAttempt).where(m.HealthOAuthAttempt.state_hash == digest(state)))
        db.commit()
        if consumed.rowcount != 1:
            raise HTTPException(400, "Google Health connection already used.")
        db.info["owner_email"] = owner
        outcome = "cancelled" if error else "connected"
        try:
            if not error:
                if not code:
                    raise HTTPException(400, "Missing authorization code.")
                client_id, secret, redirect = config()
                with httpx.Client(timeout=20) as client:
                    tokens = provider_request(client, "POST", "https://oauth2.googleapis.com/token", data={
                        "grant_type": "authorization_code", "code": code, "client_id": client_id,
                        "client_secret": secret, "redirect_uri": redirect, "code_verifier": verifier})
                    identity = m.id_token.verify_oauth2_token(tokens.get("id_token", ""), m.GOOGLE_REQUEST, client_id)
                    email = str(identity.get("email", "")).lower()
                    local = m.APP_ENV == "development" and owner == "local@workout.local"
                    if not identity.get("email_verified") or (email != owner and not local):
                        raise HTTPException(400, "Use the same Google account as your Jern sign-in.")
                    provider_request(client, "GET", BASE + "/identity", headers={"Authorization": "Bearer " + tokens["access_token"]})
                    scopes = set(tokens.get("scope", "").split()) & set(SCOPES.values())
                    if not scopes or not tokens.get("refresh_token"):
                        raise HTTPException(400, "Grant Health access and allow offline access, then reconnect.")
                    item = connection(db)
                    if item is None:
                        item = m.HealthConnection(account_email=email, tokens="", scopes="")
                        db.add(item)
                    item.account_email, item.scopes = email, " ".join(sorted(scopes))
                    item.tokens = pack({"access_token": tokens["access_token"], "refresh_token": tokens["refresh_token"],
                                        "expires_at": int(time.time()) + int(tokens.get("expires_in", 3600))})
                    item.snapshot, item.fetched_at = "{}", 0
                    db.commit()
        except (HTTPException, ValueError, m.GoogleAuthError, KeyError):
            db.rollback()
            outcome = "failed"
    # Fixed frontend destination; never redirect to a user-controlled URL.
    redirect_uri = config()[2]
    parsed = urlsplit(redirect_uri)
    result = RedirectResponse(f"{parsed.scheme}://{parsed.netloc}/?health={outcome}#health", status_code=303)
    result.delete_cookie(COOKIE, path=CALLBACK_PATH)
    result.headers["Cache-Control"] = "no-store"
    result.headers["Referrer-Policy"] = "no-referrer"
    return result


@router.delete("/google")
def disconnect(db: Session = Depends(m.get_db)):
    item = connection(db)
    if item:
        try:
            tokens = unpack(item)
            with httpx.Client(timeout=10) as client:
                client.post("https://oauth2.googleapis.com/revoke", data={"token": tokens["refresh_token"]})
        except (httpx.HTTPError, HTTPException):
            pass  # Local deletion always succeeds; Google access can also be revoked in account settings.
        db.delete(item)
    db.execute(delete(m.HealthOAuthAttempt).where(m.HealthOAuthAttempt.owner_email == db.info["owner_email"]))
    db.commit()
    return {"saved": True}


class GoalIn(BaseModel):
    step_goal: int = Field(ge=1000, le=100000)


@router.patch("/goal")
def goal(payload: GoalIn, db: Session = Depends(m.get_db)):
    item = connection(db)
    if not item:
        raise HTTPException(409, "Connect Google Health first.")
    item.step_goal = payload.step_goal
    db.commit()
    return {**output(item), "saved": True}


def number(value):
    try:
        result = float(value)
        return result if math.isfinite(result) and result >= 0 else None
    except (ValueError, TypeError):
        return None


def iso_date(value):
    if not isinstance(value, dict):
        return None
    try:
        return date(int(value["year"]), int(value["month"]), int(value["day"])).isoformat()
    except (KeyError, ValueError, TypeError):
        return None


def local_date(interval, end=False):
    side = "end" if end else "start"
    civil = iso_date(interval.get("civil" + side.title() + "Time", {}).get("date"))
    if civil:
        return civil
    stamp = interval.get(side + "Time")
    if not stamp:
        return None
    return (datetime.fromisoformat(stamp.replace("Z", "+00:00")) + timedelta(seconds=float(interval.get(side + "UtcOffset", "0s").removesuffix("s")))).date().isoformat()


def step_counts(rows, start, end):
    counts = {}
    for point in rows:
        day = iso_date(point.get("civilStartTime", {}).get("date"))
        steps = number(point.get("steps", {}).get("countSum"))
        if day and start <= day < end and steps is not None:
            counts[day] = steps
    return counts


def normalize(results, today):
    days = { (today - timedelta(days=n)).isoformat(): {"date": (today - timedelta(days=n)).isoformat(),
            "steps": None, "active_minutes": None, "sleep_minutes": None, "hrv": None, "resting_hr": None} for n in reversed(range(7)) }
    for day, steps in step_counts(results.get("steps", []), min(days), (today + timedelta(days=1)).isoformat()).items():
        days[day]["steps"] = steps
    for point in results.get("active_minutes", []):
        day = iso_date(point.get("civilStartTime", {}).get("date"))
        if day in days and "activeMinutes" in point:
            levels = point["activeMinutes"].get("activeMinutesRollupByActivityLevel", [])
            days[day]["active_minutes"] = sum(number(level.get("activeMinutesSum")) or 0 for level in levels)
    for metric, field, key in (("hrv", "dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds"),
                               ("resting_hr", "dailyRestingHeartRate", "beatsPerMinute")):
        for point in results.get(metric, []):
            data = point.get(field, {})
            day = iso_date(data.get("date"))
            if day in days and days[day][metric] is None:
                days[day][metric] = number(data.get(key))
    sleeps = []
    for point in results.get("sleep", []):
        data = point.get("sleep", {})
        interval = data.get("interval", {})
        day = local_date(interval, end=True)
        minutes = number(data.get("summary", {}).get("minutesAsleep"))
        if day not in days:
            continue
        sleeps.append({"date": day, "start": interval.get("startTime"), "end": interval.get("endTime"),
                       "minutes": minutes, "main": bool(data.get("metadata", {}).get("mainSleep")),
                       "stages": [{"start": v.get("startTime"), "end": v.get("endTime"), "type": v.get("type", "UNKNOWN")} for v in data.get("stages", [])]})
    # One principal sleep per wake date; naps are not added to the overnight trend.
    principal = []
    for day in days:
        options = [v for v in sleeps if v["date"] == day]
        if options:
            best = max(options, key=lambda v: (v["main"], v["minutes"] or 0))
            days[day]["sleep_minutes"] = best["minutes"]
            principal.append(best)
    workouts = []
    for point in results.get("workouts", []):
        data = point.get("exercise", {})
        interval = data.get("interval", {})
        day = local_date(interval)
        if day in days:
            workouts.append({"date": day, "type": data.get("exerciseType", "OTHER"),
                             "start": interval.get("startTime"), "end": interval.get("endTime"),
                             "minutes": (number(data.get("activeDuration", "").removesuffix("s")) or 0) / 60})
    return {"days": list(days.values()), "sleep": principal[-1] if principal else None, "workouts": workouts,
            "sleep_intervals": [{key: item[key] for key in ("start", "end", "minutes", "stages")} for item in sleeps]}


def daily_rollup(datatype, start, end):
    def civil(day):
        return {"date": {"year": day.year, "month": day.month, "day": day.day}}
    return "POST", f"{BASE}/dataTypes/{datatype}/dataPoints:dailyRollUp", {"json": {
        "range": {"start": civil(start), "end": civil(end)}, "windowSizeDays": 1}}


def provider_pages(token, method, url, kwargs):
    rows = []
    with httpx.Client(timeout=20, headers={"Authorization": "Bearer " + token}) as client:
        for _ in range(50):
            body = provider_request(client, method, url, **kwargs)
            rows.extend(body.get("rollupDataPoints", body.get("dataPoints", [])))
            page = body.get("nextPageToken")
            if not page:
                return rows
            kwargs.setdefault("json" if method == "POST" else "params", {})["pageToken"] = page
    raise HTTPException(502, "Google Health returned too many records; retry later.")


def fetch_data(token, scopes, today):
    start, end = today - timedelta(days=6), today + timedelta(days=1)
    tasks = []
    if SCOPES["activity"] in scopes:
        for label, datatype in (("steps", "steps"), ("active_minutes", "active-minutes")):
            tasks.append((label, *daily_rollup(datatype, start, end)))
        tasks.append(("workouts", "GET", BASE + "/dataTypes/exercise/dataPoints:reconcile", {"params": {"filter": f'exercise.interval.civil_start_time >= "{start}" AND exercise.interval.civil_start_time < "{end}"'}}))
    if SCOPES["sleep"] in scopes:
        tasks.append(("sleep", "GET", BASE + "/dataTypes/sleep/dataPoints:reconcile", {"params": {"filter": f'sleep.interval.civil_end_time >= "{start}" AND sleep.interval.civil_end_time < "{end}"'}}))
    if SCOPES["recovery"] in scopes:
        for label, datatype, field in (("hrv", "daily-heart-rate-variability", "daily_heart_rate_variability"), ("resting_hr", "daily-resting-heart-rate", "daily_resting_heart_rate")):
            tasks.append((label, "GET", f"{BASE}/dataTypes/{datatype}/dataPoints:reconcile", {"params": {"filter": f'{field}.date >= "{start}" AND {field}.date < "{end}"'}}))
    def safe_fetch(task):
        label, method, url, kwargs = task
        try:
            return label, provider_pages(token, method, url, kwargs), None
        except HTTPException as error:
            return label, [], error.detail
    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(safe_fetch, tasks))
    data = normalize({key: rows for key, rows, _ in results}, today)
    data["warnings"] = {key: error for key, _, error in results if error}
    return data


def step_history_start(token, before):
    # Find a date before the oldest reading without downloading minute-by-minute records.
    with httpx.Client(timeout=20, headers={"Authorization": "Bearer " + token}) as client:
        def has_steps_before(day):
            page = provider_request(client, "GET", BASE + "/dataTypes/steps/dataPoints", params={
                "pageSize": 1, "filter": f'steps.interval.civil_start_time < "{day}"',
            })
            return bool(page.get("dataPoints") or page.get("nextPageToken"))

        if not has_steps_before(before):
            return before
        upper = before - timedelta(days=1)
        distance = STEP_ROLLUP_DAYS
        lower = date.fromordinal(max(1, upper.toordinal() - distance))
        while lower > date.min and has_steps_before(lower):
            upper = lower - timedelta(days=1)
            distance *= 2
            lower = date.fromordinal(max(1, upper.toordinal() - distance))
        while (upper - lower).days >= STEP_ROLLUP_DAYS:
            middle = lower + (upper - lower) // 2
            if has_steps_before(middle):
                upper = middle - timedelta(days=1)
            else:
                lower = middle
        return lower


def sync_step_history(token, history, data, today):
    recent_start = today - timedelta(days=6)
    through = date.fromisoformat(history["through"]) if history else None
    start = through + timedelta(days=1) if through else step_history_start(token, recent_start)
    counts = {day: steps for day, steps in (history["days"].items() if history else ())
              if day < recent_start.isoformat() or day > today.isoformat()}

    def rollup(first):
        end = min(first + timedelta(days=STEP_ROLLUP_DAYS), recent_start)
        rows = provider_pages(token, *daily_rollup("steps", first, end))
        return step_counts(rows, first.isoformat(), end.isoformat())

    windows = [start + timedelta(days=offset) for offset in range(0, (recent_start - start).days, STEP_ROLLUP_DAYS)]
    if windows:
        parallel = 4
        with ThreadPoolExecutor(max_workers=parallel) as pool:
            for offset in range(0, len(windows), parallel):
                for days in pool.map(rollup, windows[offset:offset + parallel]):
                    counts.update(days)
    counts.update({day["date"]: day["steps"] for day in data["days"] if day["steps"] is not None})
    return {"through": max(today, through or today).isoformat(), "days": counts}


class SyncIn(BaseModel):
    # Browser's local date selects the seven civil days. Provider civil times
    # retain the wearable's day boundaries, including travel and DST.
    today: date


@router.post("/sync")
def sync(payload: SyncIn, request: Request, db: Session = Depends(m.get_db)):
    if abs((payload.today - datetime.now(timezone.utc).date()).days) > 1:
        raise HTTPException(400, "Sync date must be today in your timezone.")
    item = connection(db)
    if not item:
        raise HTTPException(409, "Connect Google Health first.")
    retry = m._rate_limit(request.state.user_email, "health-sync", 6)
    if retry:
        raise HTTPException(429, "Wait a moment before syncing again.")
    with httpx.Client(timeout=20) as client:
        token = access_token(db, item, client)
    item_id, scopes, tokens, previous_snapshot = item.id, set(item.scopes.split()), item.tokens, item.snapshot
    db.rollback()  # Provider requests do not need to hold a database transaction open.
    data = fetch_data(token, scopes, payload.today)
    # Keep old values visibly dated when every provider request failed.
    expected = (3 if SCOPES["activity"] in scopes else 0) + (1 if SCOPES["sleep"] in scopes else 0) + (2 if SCOPES["recovery"] in scopes else 0)
    if len(data["warnings"]) == expected:
        raise HTTPException(502, next(iter(data["warnings"].values())))
    if SCOPES["activity"] in scopes:
        history = json.loads(previous_snapshot).get("step_history")
        if "steps" not in data["warnings"]:
            try:
                history = sync_step_history(token, history, data, payload.today)
            except HTTPException as error:
                data["warnings"]["step_history"] = error.detail
        if history is not None:
            data["step_history"] = history
    # Preserve a newer sync or reconnect if another request replaced this snapshot.
    db.execute(update(m.HealthConnection).where(
        m.HealthConnection.id == item_id, m.HealthConnection.owner_email == db.info["owner_email"],
        m.HealthConnection.snapshot == previous_snapshot, m.HealthConnection.tokens == tokens,
    ).values(snapshot=json.dumps(data), fetched_at=int(time.time())))
    db.commit()
    return {**output(connection(db)), "saved": True}

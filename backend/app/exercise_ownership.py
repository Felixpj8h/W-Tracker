"""Assign existing custom exercises to the account that uses them.

Custom exercises used to be rows in the shared catalogue. Each one now belongs
to one account. A custom exercise is given an owner only when exactly one
account refers to it. One used by several accounts, or by none, stays shared:
everyone can still use it, and no account can change or delete it.
"""
import json
from typing import Any

from sqlalchemy import text

# Every place that stores an exercise ID, with the account that owns the row.
_DIRECT_REFERENCES = (
    "SELECT re.exercise_id, r.owner_email FROM routine_exercises re JOIN routines r ON r.id = re.routine_id",
    "SELECT we.cached_exercise_id, w.owner_email FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id",
)
# JSON documents that embed exercise IDs: planned-day overrides, substituted
# exercises and pending coach proposals.
_JSON_REFERENCES = (
    "SELECT workout_override, owner_email FROM calendar_assignments WHERE workout_override IS NOT NULL",
    "SELECT we.substituted_from, w.owner_email FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE we.substituted_from IS NOT NULL",
    "SELECT p.payload, c.owner_email FROM ai_change_proposals p JOIN ai_conversations c ON c.id = p.conversation_id",
)


def _exercise_ids(value: Any, found: set[int]) -> None:
    if isinstance(value, dict):
        for key, item in value.items():
            if key in ("exercise_id", "cached_exercise_id") and isinstance(item, int):
                found.add(item)
            else:
                _exercise_ids(item, found)
    elif isinstance(value, list):
        for item in value:
            _exercise_ids(item, found)


def assign_custom_exercise_owners(connection) -> int:
    """Give unowned custom exercises an owner when exactly one account uses them."""
    custom = {row[0] for row in connection.execute(text(
        "SELECT id FROM exercises WHERE wger_id IS NULL AND owner_email IS NULL"))}
    if not custom:
        return 0
    owners: dict[int, set[str]] = {exercise_id: set() for exercise_id in custom}
    for query in _DIRECT_REFERENCES:
        for exercise_id, owner in connection.execute(text(query)):
            if exercise_id in owners and owner:
                owners[exercise_id].add(owner)
    for query in _JSON_REFERENCES:
        for document, owner in connection.execute(text(query)):
            try:
                value = json.loads(document) if isinstance(document, (str, bytes)) else document
            except ValueError:
                continue
            found: set[int] = set()
            _exercise_ids(value, found)
            for exercise_id in found & custom:
                if owner:
                    owners[exercise_id].add(owner)
    assigned = 0
    for exercise_id, accounts in owners.items():
        if len(accounts) == 1:
            connection.execute(text("UPDATE exercises SET owner_email = :owner WHERE id = :id AND owner_email IS NULL"),
                               {"owner": next(iter(accounts)), "id": exercise_id})
            assigned += 1
    return assigned

"""Optional, paid live Jev evaluation using synthetic data only; no Gemini or DB."""
import argparse
from collections import Counter
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from app.topic_policy import classify


def state_for(case):
    if case["stage"] == "input":
        return {"latest_message": case["text"], "recent_context": case.get("context", [])}
    return {"response": case["text"], "tool_calls": case.get("calls", [])}


def report(rows):
    allowed = [row for row in rows if row["expected"] == "allow"]
    blocked = [row for row in rows if row["expected"] == "block"]
    fp = sum(row["actual"] == "block" for row in allowed)
    fn = sum(row["actual"] in ("allow", "unavailable") for row in blocked)
    return {
        "examples": len(rows), "outcomes": dict(Counter(row["actual"] for row in rows)),
        "false_positives": fp, "allowed_examples": len(allowed),
        "false_positive_rate": fp / len(allowed) if allowed else None,
        "false_negatives": fn, "blocked_examples": len(blocked),
        "false_negative_rate": fn / len(blocked) if blocked else None,
        "allowed_but_uncertain": sum(row["actual"] == "uncertain" for row in allowed),
        "rows": rows,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Make paid TypeSafe calls using synthetic examples")
    args = parser.parse_args()
    if not args.live:
        parser.error("Pass --live to opt into paid requests. This is separate from mocked automated tests.")
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    if not os.getenv("TYPESAFE_API_KEY", "").strip():
        parser.error("Set backend TYPESAFE_API_KEY before running the live evaluation.")
    cases = json.loads((Path(__file__).parent / "evaluations" / "topic_cases.json").read_text(encoding="utf-8"))
    rows = []
    for case in cases:
        result = classify(state_for(case), case["stage"])
        rows.append({"id": case["id"], "stage": case["stage"], "expected": case["expected"],
                     "actual": result.decision, "category": result.category,
                     "probabilities": result.probabilities, "failure_type": result.failure_type})
    print(json.dumps({"model": os.getenv("TYPESAFE_MODEL", "jev-latest"), **report(rows)}, indent=2))
    # A degraded run must never look like an accuracy result from Jev.
    return 2 if any(row["actual"] == "unavailable" for row in rows) else 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Mocked policy/flow tests verify enforcement, not real Jev classification accuracy."""
from pathlib import Path
from types import SimpleNamespace
import json
import sys
from threading import Event

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import chatBot, topic_policy as policy

CASES = json.loads((Path(__file__).resolve().parents[1] / "evaluations" / "topic_cases.json").read_text(encoding="utf-8"))


def answer(category="training", topic_p=0.94, **hazards):
    probabilities = {key: (1 - topic_p) / (len(policy.TOPICS) - 1) for key in policy.TOPICS}
    probabilities[category] = topic_p
    return SimpleNamespace(
        # Deliberately useless confidence: decisions must use probabilities.
        choices={"topic": SimpleNamespace(choice=category, probabilities=probabilities, confidence=0)},
        nouls={key: SimpleNamespace(noul=hazards.get(key, 0.01)) for key in ("outside_scope", "software", "override")},
    )


@pytest.fixture
def sdk_mock(monkeypatch):
    """Mock only the documented SDK surface, retaining real application decision code."""
    seen = []
    responses = []

    class Primitive:
        def __init__(self, **kwargs):
            self.__dict__.update(kwargs)

    class Client:
        def __init__(self, **kwargs):
            seen.append({"config": kwargs})

        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def system_one(self, **kwargs):
            seen.append(kwargs)
            response = responses.pop(0)
            if isinstance(response, Exception):
                raise response
            return response

    monkeypatch.setitem(sys.modules, "typesafe_sdk", SimpleNamespace(
        TypeSafeClient=Client, Choice=Primitive, Noul=Primitive, RetryPolicy=Primitive,
    ))
    monkeypatch.setenv("TYPESAFE_API_KEY", "synthetic-key")
    for variable in ("TYPESAFE_MODEL", "TYPESAFE_SAFE_MAX", "TYPESAFE_BLOCK_MIN", "TYPESAFE_TOPIC_MIN"):
        monkeypatch.delenv(variable, raising=False)
    return seen, responses


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_synthetic_decisions_use_typed_batched_questions(case, sdk_mock):
    from evaluate_topics import state_for
    seen, responses = sdk_mock
    responses.append(answer(case["topic"], **{key: case[key] for key in ("software", "outside_scope", "override") if key in case}))
    result = policy.classify(state_for(case), case["stage"])
    assert result.decision == case["expected"]
    assert len(seen) == 2  # one client, one system_one request per checkpoint
    assert seen[1]["state"] == state_for(case)
    questions = seen[1]["questions"]
    assert set(questions) == {"topic", "outside_scope", "software", "override"}
    assert questions["topic"].criteria == policy.TOPICS
    assert "untrusted" in questions["topic"].instructions
    assert ("REQUESTS" if case["stage"] == "input" else "ACTUALLY SUPPLIES") in questions["topic"].instructions
    assert seen[0]["config"]["model"] == "jev-latest"
    assert seen[0]["config"]["timeout"] == 3.0
    assert seen[0]["config"]["retry"].max_retries == 1
    assert seen[0]["config"]["retry"].timeout == 7.0
    assert seen[0]["config"]["retry"].respect_retry_after is False


@pytest.mark.parametrize("field", ["software", "outside_scope", "override"])
@pytest.mark.parametrize(("value", "expected"), [
    (0, "allow"), (0.3, "allow"), (0.300001, "uncertain"),
    (0.699999, "uncertain"), (0.7, "block"), (1, "block"),
])
def test_noul_boundaries_and_hazard_precedence(field, value, expected):
    assert policy.decide(answer(**{field: value}), policy.Thresholds()).decision == expected


@pytest.mark.parametrize(("value", "expected"), [(0.699999, "uncertain"), (0.7, "allow"), (0.700001, "allow")])
def test_topic_probability_boundaries(value, expected):
    response = answer()
    response.choices["topic"].probabilities = dict.fromkeys(policy.TOPICS, 0.0)
    response.choices["topic"].probabilities.update(training=value, unclear=1 - value)
    assert policy.decide(response, policy.Thresholds()).decision == expected


@pytest.mark.parametrize("hazards,expected", [
    ({}, "allow"), ({"outside_scope": 0.5}, "uncertain"),
    ({"outside_scope": 0.8}, "block"), ({"software": 0.8}, "block"),
    ({"override": 0.8}, "block"),
])
def test_confidence_split_across_allowed_topics(hazards, expected):
    response = answer(**hazards)
    response.choices["topic"].probabilities = dict.fromkeys(policy.TOPICS, 0.0)
    response.choices["topic"].probabilities.update(
        training=0.4, nutrition=0.25, recovery=0.25, unclear=0.1,
    )
    assert policy.decide(response, policy.Thresholds()).decision == expected


def test_unclear_primary_topic_still_needs_clarification():
    response = answer("unclear")
    response.choices["topic"].probabilities = dict.fromkeys(policy.TOPICS, 0.0)
    response.choices["topic"].probabilities.update(
        unclear=0.28, training=0.25, nutrition=0.24, recovery=0.23,
    )
    assert policy.decide(response, policy.Thresholds()).decision == "uncertain"


def test_category_and_custom_thresholds():
    assert policy.decide(answer("out_of_scope", 0.7), policy.Thresholds()).decision == "block"
    assert policy.decide(answer("out_of_scope", 0.69), policy.Thresholds()).decision == "uncertain"
    assert policy.decide(answer("unclear"), policy.Thresholds()).decision == "uncertain"
    assert policy.decide(answer(software=0.8), policy.Thresholds(block_min=0.9)).decision == "uncertain"


@pytest.mark.parametrize("invalid", [float("nan"), float("inf"), -0.01, 1.01, True, "0.8", None])
def test_invalid_probability_is_technical_failure(invalid, sdk_mock):
    _, responses = sdk_mock
    responses.append(answer(software=invalid))
    result = policy.classify({"latest_message": "Synthetic"}, "input")
    assert result.decision == "unavailable" and not result.permits
    assert result.failure_type == "malformed_response_or_configuration"


@pytest.mark.parametrize("error, failure", [
    (TimeoutError("private text must not be logged"), "timeout"),
    (ValueError("private text must not be logged"), "malformed_response_or_configuration"),
    (ImportError("private text must not be logged"), "sdk_unavailable"),
    (ConnectionError("private text must not be logged"), "connection_or_sdk_error"),
])
def test_technical_failure_withholds_output_and_is_logged_without_content(error, failure, sdk_mock, monkeypatch):
    _, responses = sdk_mock
    responses.append(error)
    logs = []
    monkeypatch.setattr(policy.LOGGER, "warning", lambda *args: logs.append(args))
    result = policy.classify({"latest_message": "private synthetic health details"}, "input")
    assert result.decision == "unavailable" and not result.permits
    assert result.failure_type == failure
    assert "private" not in str(logs)
    assert "screening_unavailable" in str(logs)


@pytest.mark.parametrize("status,failure", [(401, "authentication"), (403, "authentication"), (429, "rate_limit"), (503, "api_error")])
def test_http_failures(status, failure, sdk_mock):
    _, responses = sdk_mock
    error = RuntimeError("do not expose response body")
    error.status = status
    responses.append(error)
    assert policy.classify({}, "output").failure_type == failure


def test_missing_credentials_and_uncertainty_are_distinct(monkeypatch, sdk_mock):
    _, responses = sdk_mock
    responses.append(answer(software=0.5))
    uncertain = policy.classify({}, "input")
    assert uncertain.decision == "uncertain" and not uncertain.permits
    assert uncertain.failure_type is None and uncertain.reply == policy.CLARIFICATION
    monkeypatch.delenv("TYPESAFE_API_KEY")
    missing = policy.classify({}, "input")
    assert missing.decision == "unavailable" and not missing.permits
    assert missing.failure_type == "missing_credentials"


@pytest.mark.parametrize("key", ["synthetic key", "synthetic\nkey", "synthetic\x7fkey", "nøkkel"])
def test_invalid_credentials_withhold_output_without_sdk_call(key, sdk_mock, monkeypatch):
    seen, _ = sdk_mock
    monkeypatch.setenv("TYPESAFE_API_KEY", key)
    result = policy.classify({}, "input")
    assert result.decision == "unavailable" and not result.permits
    assert result.failure_type == "invalid_credentials" and not seen


@pytest.mark.parametrize("mutation", ["missing", "unknown", "sum", "winner"])
def test_malformed_choice(sdk_mock, mutation):
    _, responses = sdk_mock
    response = answer()
    if mutation == "missing": response.choices = {}
    elif mutation == "unknown": response.choices["topic"].probabilities["unexpected"] = 0
    elif mutation == "sum": response.choices["topic"].probabilities["training"] = 0.5
    else: response.choices["topic"].choice = "recovery"
    responses.append(response)
    assert policy.classify({}, "input").decision == "unavailable"


def test_invalid_config_is_degraded_and_model_is_separate(sdk_mock, monkeypatch):
    seen, responses = sdk_mock
    monkeypatch.setenv("TYPESAFE_MODEL", "jev-pinned-test")
    monkeypatch.setenv("GEMINI_MODEL", "unrelated-gemini-model")
    responses.append(answer())
    assert policy.classify({}, "output").decision == "allow"
    assert seen[0]["config"]["model"] == "jev-pinned-test"
    monkeypatch.setenv("TYPESAFE_SAFE_MAX", "0.9")
    assert policy.classify({}, "output").decision == "unavailable"


def test_installed_official_sdk_contract_without_network(monkeypatch):
    sdk = pytest.importorskip("typesafe_sdk", reason="Official SDK not installed; run with locked backend dependencies")
    captured = []

    def system_one(_client, *, state, questions):
        assert isinstance(questions["topic"], sdk.Choice)
        assert all(isinstance(questions[key], sdk.Noul) for key in ("software", "outside_scope", "override"))
        captured.append(state)
        return answer()

    monkeypatch.setattr(sdk.TypeSafeClient, "system_one", system_one)
    result = policy._screen({"latest_message": "Synthetic workout"}, "input", "jev-latest", "synthetic-key", policy.Thresholds())
    assert result.decision == "allow" and len(captured) == 1


@pytest.fixture
def flow(monkeypatch):
    saved, executed, states = [], [], []
    interactions = []
    decisions = []
    monkeypatch.setattr(chatBot, "_classification_input", lambda *_: {"latest_message": "Build a routine", "recent_context": []})
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_: [])
    monkeypatch.setattr(chatBot, "_maybe_summarize", lambda *_: None)
    monkeypatch.setattr(chatBot, "_save_assistant", lambda *args: saved.append(args) or 8)
    monkeypatch.setattr(chatBot, "execute_tool", lambda *args: executed.append(args) or {"proposal_id": 5})

    def classify(state, stage):
        states.append((stage, state))
        decision = decisions.pop(0)
        return policy.Assessment(decision)

    monkeypatch.setattr(chatBot, "classify", classify)
    provider_calls = []

    def create(**kwargs):
        provider_calls.append(kwargs)
        return interactions.pop(0)

    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=SimpleNamespace(create=create)))
    return SimpleNamespace(saved=saved, executed=executed, states=states, interactions=interactions,
                           decisions=decisions, provider_calls=provider_calls)


def response(text="", calls=None):
    return SimpleNamespace(output_text=text, steps=calls or [])


def test_math_source_survives_screening_streaming_and_storage(flow):
    text = "That is 128 g of protein.\n\n$$\n" + r"\text{80 kg} \times 1.6\text{ g/kg} = 128\text{ g}" + "\n$$"
    flow.interactions.append(response(text))
    flow.decisions.extend(["allow"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert "".join(event["text"] for event in events if event["type"] == "text.delta") == text
    assert flow.saved[0][2] == text
    assert flow.states[-1][1]["response"] == text


def test_capabilities_turn_after_refusal_is_screened_independently(flow):
    flow.decisions.append("block")
    flow.interactions.append(response("Rejected programming help"))
    refused = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert any(event.get("text") == policy.REFUSAL for event in refused)
    assert len(flow.provider_calls) == 1

    reply = "You can ask about training, nutrition, recovery, general health and Jern workout features."
    flow.decisions.extend(["allow"])
    flow.interactions.append(response(reply))
    events = list(chatBot.stream_coach_turn(1, 3, "test@example.com"))
    assert "".join(event["text"] for event in events if event["type"] == "text.delta") == reply
    assert flow.saved[-1][2] == reply
    assert len(flow.provider_calls) == 2


def test_contextual_request_goes_directly_to_coach_before_output_screening(flow, monkeypatch):
    context = {"latest_message": "whats the science behind this?", "recent_context": []}
    monkeypatch.setattr(chatBot, "_classification_input", lambda *_: context)
    flow.interactions.append(response("Rest days allow recovery between training sessions."))
    flow.decisions.append("allow")
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert len(flow.provider_calls) == 1
    assert [stage for stage, _ in flow.states] == ["output"]
    assert flow.states[0][1]["request_context"] == context
    assert flow.saved[0][2] == "Rest days allow recovery between training sessions."
    assert events[-1]["type"] == "message.completed"


@pytest.mark.parametrize("decision", ["block", "uncertain"])
def test_generated_code_is_never_streamed_or_saved(flow, decision):
    code = "```python\nprint('synthetic rejected code')\n```"
    flow.interactions.append(response(code))
    flow.decisions.extend([decision])
    if decision == "uncertain":
        flow.interactions.append(response(code))
        flow.decisions.append("uncertain")
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert code not in str(events) and code not in str(flow.saved)
    assert flow.saved[0][2] in (policy.REFUSAL, policy.OUTPUT_UNCERTAIN)
    assert flow.states[0][1]["response"] == code


@pytest.mark.parametrize("calls", [[], [{"type": "function_call", "name": "get_weekly_plan", "id": "read", "arguments": {}}]])
def test_unavailable_screening_never_releases_output_or_executes_tools(flow, calls):
    text = "Unverified generated content"
    flow.interactions.append(response(text, calls))
    flow.decisions.append("unavailable")
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert not flow.executed
    assert text not in str(events) and text not in str(flow.saved)
    assert flow.saved[0][2] == policy.OUTPUT_UNAVAILABLE
    assert not any(event["type"].startswith(("tool.", "proposal.")) for event in events)


def test_tool_only_step_keeps_request_context_and_executes_after_screening(flow):
    call = {"type": "function_call", "name": "get_weekly_plan", "id": "read", "arguments": {}}
    flow.interactions.extend([response(calls=[call]), response("Include rest days between hard sessions.")])
    flow.decisions.extend(["allow", "allow"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    state = flow.states[0][1]
    assert state["response"] == "" and state["generation_kind"] == "tool_step"
    assert state["request_context"] == {"latest_message": "Build a routine", "recent_context": []}
    assert state["tool_calls"][0]["name"] == "get_weekly_plan"
    assert len(flow.executed) == 1
    assert events[-1]["type"] == "message.completed"


def test_uncertain_tool_step_is_discarded_and_regenerated_before_execution(flow):
    rejected = {"type": "function_call", "name": "get_weekly_plan", "id": "rejected", "arguments": {}}
    accepted = {**rejected, "id": "accepted"}
    flow.interactions.extend([
        response(calls=[rejected]),
        response("I will review your weekly training plan.", [accepted]),
        response("Balance hard sessions with rest days."),
    ])
    flow.decisions.extend(["uncertain", "allow", "allow"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert len(flow.executed) == 1  # only the regenerated batch ran
    assert flow.saved[0][2] == "Balance hard sessions with rest days."
    assert policy.CLARIFICATION not in str(events)
    assert all(step.get("id") != "rejected" for step in flow.provider_calls[-1]["input"])


def test_output_uncertainty_retry_is_bounded_and_never_executes_calls(flow):
    call = {"type": "function_call", "name": "get_weekly_plan", "id": "read", "arguments": {}}
    flow.interactions.extend([response(calls=[call]), response(calls=[call])])
    flow.decisions.extend(["uncertain", "uncertain"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert len(flow.provider_calls) == 2 and not flow.executed
    assert flow.saved[0][2] == policy.OUTPUT_UNCERTAIN
    assert policy.CLARIFICATION not in str(events)
    assert events[-1]["type"] == "message.completed"


def test_regeneration_cannot_bypass_blocked_output(flow):
    flow.interactions.extend([response("Uncertain output"), response("Rejected coding instructions")])
    flow.decisions.extend(["uncertain", "block"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert flow.saved[0][2] == policy.REFUSAL and not flow.executed
    assert "Rejected coding instructions" not in str(events)


def test_all_arguments_are_checked_before_any_tool_executes(flow):
    calls = [
        {"type": "function_call", "name": "search_exercises", "id": "read", "arguments": {"query": "squat"}},
        {"type": "function_call", "name": "propose_create_routine", "id": "bad", "arguments": {
            "routine": {"name": "Upper", "notes": "An unrelated essay"},
            "summary": "Synthetic outside topic", "reasoning": "Coding advice",
        }},
    ]
    flow.interactions.append(response("Looks good", calls))
    flow.decisions.extend(["block"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert not flow.executed
    assert flow.states[0][1]["tool_calls"][1]["arguments"] == calls[1]["arguments"]
    assert not any(e["type"].startswith(("tool.", "proposal.")) for e in events)
    assert "Coding advice" not in str(flow.saved)


def test_valid_screened_proposals_keep_confirmation_flow(flow):
    args = {"routine": {"name": "Upper A", "exercises": []}, "summary": "Create Upper A", "reasoning": "Fits your schedule"}
    flow.interactions.extend([
        response(calls=[{"type": "function_call", "name": "propose_create_routine", "id": "good", "arguments": args}]),
        response("Your proposal is ready to review and confirm."),
    ])
    flow.decisions.extend(["allow", "allow"])
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com"))
    assert len(flow.executed) == 1 and flow.executed[0][1] == args
    assert any(e["type"] == "proposal.created" for e in events)
    assert "tools" not in flow.provider_calls[-1]
    assert events[-1]["type"] == "message.completed"


def test_cancellation_during_output_screening_prevents_release(flow, monkeypatch):
    cancelled = Event()
    flow.interactions.append(response("A checked workout response"))

    def classify(_state, current):
        assert current == "output"
        cancelled.set()
        return policy.Assessment("allow")

    monkeypatch.setattr(chatBot, "classify", classify)
    events = list(chatBot.stream_coach_turn(1, 2, "test@example.com", cancelled.is_set))
    assert events[-1]["type"] == "message.interrupted"
    assert not flow.executed
    assert not any(e["type"] == "text.delta" for e in events)


def test_cancel_between_chunks_and_cancel_scope_replacement(flow):
    flow.interactions.append(response("A" * 200))
    flow.decisions.extend(["allow"])
    event = chatBot.begin_cancel_scope(1)
    stream = chatBot.stream_coach_turn(1, 2, "test@example.com", event.is_set)
    assert next(stream)["type"] == "message.started"
    assert next(stream)["type"] == "text.delta"
    assert chatBot.request_cancel(1)
    assert list(stream)[-1]["type"] == "message.interrupted"
    replacement = chatBot.begin_cancel_scope(1)
    chatBot.end_cancel_scope(1, event)
    assert chatBot.request_cancel(1) and replacement.is_set()
    chatBot.end_cancel_scope(1, replacement)


@pytest.fixture
def database(monkeypatch):
    from app import main
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False)
    monkeypatch.setattr(main, "SessionLocal", factory)
    yield main, factory
    engine.dispose()


def test_input_context_uses_exact_owned_message_and_only_recent_context(database):
    main, factory = database
    with factory(info={"owner_email": "a@test.example"}) as db:
        conversation = main.AIConversation(owner_email="a@test.example", title="Coach")
        db.add(conversation); db.flush()
        for role, content in [("user", "old unrelated request"), ("assistant", "Try squats"), ("user", "yes")]:
            item = main.AIMessage(conversation_id=conversation.id, role=role, content=content, status="completed")
            db.add(item); db.flush()
        conversation_id, message_id = conversation.id, item.id
        db.add(main.AIMessage(conversation_id=conversation.id, role="assistant", content="later message", status="completed"))
        db.commit()
    state = chatBot._classification_input(conversation_id, message_id, "a@test.example")
    assert state["latest_message"] == "yes"
    assert len(state["recent_context"]) == 2
    assert "later message" not in str(state)
    with pytest.raises(ValueError):
        chatBot._classification_input(conversation_id, message_id, "b@test.example")
    with pytest.raises(ValueError):
        chatBot._classification_input(conversation_id, message_id + 1, "a@test.example")


def test_short_chat_history_is_kept_in_full(database):
    main, factory = database
    contents = ["Review my full-body training plan " + "x" * 2100,
                "Consider adding accessory work.", "Can you add that?",
                "The proposal is ready to review and confirm in the app."]
    with factory(info={"owner_email": "a@test.example"}) as db:
        conversation = main.AIConversation(owner_email="a@test.example", title="Coach")
        db.add(conversation); db.flush()
        for index, content in enumerate(contents + ["whats the science behind this?"]):
            message = main.AIMessage(conversation_id=conversation.id, role="user" if index % 2 == 0 else "assistant",
                                     content=content, status="completed")
            db.add(message); db.flush()
        db.commit(); cid, mid = conversation.id, message.id
    state = chatBot._classification_input(cid, mid, "a@test.example")
    assert [item["content"] for item in state["recent_context"]] == contents
    assert not state["history_truncated"]
    assert state["latest_message"] == "whats the science behind this?"


@pytest.mark.parametrize("message_limit,char_limit", [(3, 1000), (32, 15)])
def test_long_classifier_history_is_bounded_and_keeps_newest_context(database, monkeypatch, message_limit, char_limit):
    main, factory = database
    monkeypatch.setattr(chatBot, "CLASSIFICATION_HISTORY_MESSAGES", message_limit)
    monkeypatch.setattr(chatBot, "CLASSIFICATION_HISTORY_CHARS", char_limit)
    with factory(info={"owner_email": "a@test.example"}) as db:
        conversation = main.AIConversation(owner_email="a@test.example", title="Coach")
        db.add(conversation); db.flush()
        for index in range(7):
            message = main.AIMessage(conversation_id=conversation.id, role="user", content=f"message {index}", status="completed")
            db.add(message); db.flush()
        db.commit(); cid, mid = conversation.id, message.id
    state = chatBot._classification_input(cid, mid, "a@test.example")
    assert state["history_truncated"]
    assert len(state["recent_context"]) <= message_limit
    assert sum(len(item["content"]) for item in state["recent_context"]) <= char_limit
    assert state["recent_context"][-1]["content"] == "message 5"


def test_classifier_cards_are_owned_preceding_and_include_workout_details(database, monkeypatch):
    main, factory = database
    owner = "a@test.example"
    with factory() as db:
        own = main.AIConversation(owner_email=owner, title="Own")
        other = main.AIConversation(owner_email="b@test.example", title="Other")
        db.add_all([own, other]); db.flush()
        previous = main.AIMessage(conversation_id=own.id, role="assistant", content="Proposal ready", status="completed")
        db.add(previous); db.flush()
        latest = main.AIMessage(conversation_id=own.id, role="user", content="whats the science behind this?", status="completed")
        db.add(latest); db.flush()
        future = main.AIMessage(conversation_id=own.id, role="assistant", content="Later proposal", status="completed")
        db.add(future); db.flush()
        for cid, message_id, summary in [(own.id, previous.id, "Three full-body sessions"),
                                         (other.id, previous.id, "Other owner's proposal"),
                                         (own.id, future.id, "Future proposal"),
                                         (own.id, None, "Not displayed yet")]:
            db.add(main.AIChangeProposal(conversation_id=cid, message_id=message_id,
                operation="create_training_program", summary=summary, reasoning="Balance volume and recovery",
                payload=json.dumps({"routines": [{"name": "Full Body A", "exercises": [{"exercise_id": 1, "planned_sets": 3}]}]}),
                status="pending"))
        db.commit(); cid, mid = own.id, latest.id
    state = chatBot._classification_input(cid, mid, owner)
    assert len(state["proposal_context"]) == 1
    card = state["proposal_context"][0]
    assert card["summary"] == "Three full-body sessions"
    assert card["reasoning"] == "Balance volume and recovery"
    assert card["payload"]["routines"][0]["name"] == "Full Body A"
    assert not state["proposals_truncated"]
    with pytest.raises(ValueError):
        chatBot._classification_input(cid, mid, "b@test.example")

    monkeypatch.setattr(chatBot, "CLASSIFICATION_PROPOSAL_CHARS", 100)
    bounded = chatBot._classification_input(cid, mid, owner)
    assert bounded["proposals_truncated"]
    assert bounded["proposal_context"][0]["truncated"]
    assert len(bounded["proposal_context"][0]["excerpt"]) <= 100


def test_rejected_proposal_arguments_never_reach_database(database, monkeypatch):
    main, factory = database
    with factory(info={"owner_email": "a@test.example"}) as db:
        conversation = main.AIConversation(owner_email="a@test.example", title="Coach")
        db.add(conversation); db.flush()
        message = main.AIMessage(conversation_id=conversation.id, role="user", content="Create an upper routine", status="completed")
        db.add(message); db.commit()
        cid, mid = conversation.id, message.id
    calls = [{"type": "function_call", "name": "propose_create_routine", "id": "bad", "arguments": {
        "routine": {"name": "synthetic rejected code", "exercises": []}, "summary": "Create routine", "reasoning": "unrelated instructions",
    }}]
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=SimpleNamespace(create=lambda **_: response(calls=calls))))
    assessments = iter([policy.Assessment("block")])
    monkeypatch.setattr(chatBot, "classify", lambda *_: next(assessments))
    events = list(chatBot.stream_coach_turn(cid, mid, "a@test.example"))
    with factory(info={"owner_email": "a@test.example"}) as db:
        assert db.query(main.AIChangeProposal).count() == 0
        assert db.query(main.Routine).count() == 0
        assert [x.content for x in db.query(main.AIMessage).filter_by(role="assistant")] == [policy.REFUSAL]
    assert "synthetic rejected code" not in str(events)


def test_valid_screened_proposal_persists_and_still_requires_confirmation(database, monkeypatch):
    main, factory = database
    owner = "a@test.example"
    with factory(info={"owner_email": owner}) as db:
        conversation = main.AIConversation(owner_email=owner, title="Coach")
        exercise = main.Exercise(name="Squat", equipment="Barbell")
        db.add_all([conversation, exercise]); db.flush()
        message = main.AIMessage(conversation_id=conversation.id, role="user", content="Create a squat routine", status="completed")
        db.add(message); db.commit()
        cid, mid, eid = conversation.id, message.id, exercise.id
    args = {"routine": {"name": "Legs", "exercises": [{"exercise_id": eid, "planned_sets": 3}]},
            "summary": "Create Legs", "reasoning": "Three sets of squats fit the request."}
    outputs = iter([
        response(calls=[{"type": "function_call", "name": "propose_create_routine", "id": "one", "arguments": args}]),
        response("Your proposal is ready to review and confirm."),
    ])
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=SimpleNamespace(create=lambda **_: next(outputs))))
    stages = []
    monkeypatch.setattr(chatBot, "classify", lambda _state, stage: stages.append(stage) or policy.Assessment("allow"))
    events = list(chatBot.stream_coach_turn(cid, mid, owner))
    assert stages == ["output", "output"]
    with factory(info={"owner_email": owner}) as db:
        assert db.query(main.Routine).count() == 0
        proposal = db.query(main.AIChangeProposal).one()
        assert proposal.status == "pending" and proposal.message_id is not None
        main.confirm_ai_proposal(proposal.id, main.ActorContext(owner_email=owner), db)
        assert db.query(main.Routine).one().name == "Legs"
    assert any(e["type"] == "proposal.created" for e in events)


@pytest.mark.parametrize("decision", ["block", "uncertain", "unavailable", "allow"])
def test_generated_summaries_are_checked_before_storage(database, monkeypatch, decision):
    main, factory = database
    owner = "a@test.example"
    with factory(info={"owner_email": owner}) as db:
        conversation = main.AIConversation(owner_email=owner, title="Coach", summary="Previous checked summary")
        db.add(conversation); db.flush()
        for index in range(18):
            db.add(main.AIMessage(conversation_id=conversation.id, role="user" if index % 2 == 0 else "assistant",
                                  content="Synthetic training discussion", status="completed"))
        db.commit(); cid = conversation.id
    summary = "Synthetic new summary"
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=SimpleNamespace(create=lambda **_: response(summary))))
    states = []
    monkeypatch.setattr(chatBot, "classify", lambda state, stage: states.append((state, stage)) or policy.Assessment(decision))
    chatBot._maybe_summarize(cid, owner)
    assert states == [({"response": summary}, "summary")]
    with factory(info={"owner_email": owner}) as db:
        assert db.get(main.AIConversation, cid).summary == (summary if decision == "allow" else "Previous checked summary")


def test_live_report_counts_false_positives_negatives_and_uncertainty_separately():
    from evaluate_topics import report
    rows = [{"expected": expected, "actual": actual} for expected, actual in [
        ("allow", "block"), ("allow", "uncertain"), ("block", "allow"), ("block", "unavailable"), ("block", "uncertain"),
    ]]
    result = report(rows)
    assert result["false_positives"] == 1 and result["false_negatives"] == 1
    assert result["allowed_but_uncertain"] == 1

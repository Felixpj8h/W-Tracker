"""Gemini contract checks that never touch the workout database."""

from types import SimpleNamespace
import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import chatBot


def test_tool_result_is_structured_json_for_gemini_25(monkeypatch):
    class FunctionCall:
        type = "function_call"
        name = "get_training_summary"
        id = "call-1"
        arguments = {"days": 14}

        def model_dump(self, **_kwargs):
            return {"type": self.type, "name": self.name, "id": self.id, "arguments": self.arguments}

    class Interactions:
        calls = 0

        def create(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                assert kwargs["generation_config"] == {"max_output_tokens": 8192}
                assert kwargs["tools"] == chatBot.TOOL_DECLARATIONS
                return SimpleNamespace(steps=[FunctionCall()], output_text="")
            result_step = kwargs["input"][-1]
            assert result_step == {
                "type": "function_result", "name": "get_training_summary",
                "call_id": "call-1", "result": {"completed_sessions": 2},
                "is_error": False,
            }
            return SimpleNamespace(steps=[], output_text="Two sessions completed.")

    interactions = Interactions()
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=interactions))
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_args: [{"type": "user_input", "content": [{"type": "text", "text": "Review training"}]}])
    monkeypatch.setattr(chatBot, "execute_tool", lambda *_args: {"completed_sessions": 2})
    monkeypatch.setattr(chatBot, "_save_assistant", lambda *_args: 7)
    monkeypatch.setattr(chatBot, "_maybe_summarize", lambda *_args: None)

    events = list(chatBot.stream_coach_turn(1, 1, "test@example.com"))
    assert [event["type"] for event in events] == [
        "message.started", "tool.started", "tool.completed", "text.delta", "message.completed",
    ]
    assert interactions.calls == 2


def test_proposal_reply_omits_tools_and_has_small_output_budget(monkeypatch):
    class FunctionCall:
        def model_dump(self, **_kwargs):
            return {"type": "function_call", "name": "propose_create_routine", "id": "proposal-1", "arguments": {}}

    class Interactions:
        calls = 0

        def create(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                assert kwargs["generation_config"] == {"max_output_tokens": 8192}
                assert kwargs["tools"] == chatBot.TOOL_DECLARATIONS
                return SimpleNamespace(steps=[FunctionCall()], output_text="")
            assert kwargs["generation_config"] == {"max_output_tokens": 128}
            assert "tools" not in kwargs
            return SimpleNamespace(steps=[], output_text="Your proposal is ready to review and confirm.")

    interactions = Interactions()
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=interactions))
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_args: [])
    monkeypatch.setattr(chatBot, "execute_tool", lambda *_args: {
        "proposal_id": 12,
        "operation": "create_routine",
        "summary": "Create Upper A",
        "reasoning": "Adds the requested upper-body session.",
        "status": "pending",
    })
    monkeypatch.setattr(chatBot, "_save_assistant", lambda *_args: 9)
    monkeypatch.setattr(chatBot, "_maybe_summarize", lambda *_args: None)

    events = list(chatBot.stream_coach_turn(1, 1, "test@example.com"))
    assert interactions.calls == 2
    assert any(event["type"] == "proposal.created" for event in events)
    assert events[-1] == {"type": "message.completed", "message_id": 9}


def test_tool_error_is_marked_and_remains_structured_json(monkeypatch):
    class FunctionCall:
        def model_dump(self, **_kwargs):
            return {
                "type": "function_call",
                "name": "get_routine",
                "id": "call-2",
                "arguments": {"routine_id": 999},
            }

    class Interactions:
        calls = 0

        def create(self, **kwargs):
            self.calls += 1
            if self.calls == 1:
                return SimpleNamespace(steps=[FunctionCall()], output_text="")
            assert kwargs["input"][-1] == {
                "type": "function_result",
                "name": "get_routine",
                "call_id": "call-2",
                "result": {"error": "Routine not found"},
                "is_error": True,
            }
            return SimpleNamespace(steps=[], output_text="That routine was not found.")

    interactions = Interactions()
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=interactions))
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_args: [])
    monkeypatch.setattr(chatBot, "execute_tool", lambda *_args: {"error": "Routine not found"})
    monkeypatch.setattr(chatBot, "_save_assistant", lambda *_args: 8)
    monkeypatch.setattr(chatBot, "_maybe_summarize", lambda *_args: None)

    events = list(chatBot.stream_coach_turn(1, 1, "test@example.com"))
    assert events[-1] == {"type": "message.completed", "message_id": 8}
    assert interactions.calls == 2


def test_malformed_tool_call_is_reprompted_with_bounded_retries(monkeypatch):
    class MalformedToolCall(Exception):
        code = 400

    class Interactions:
        calls = 0

        def create(self, **kwargs):
            self.calls += 1
            if self.calls <= 2:
                raise MalformedToolCall("malformed_tool_call: Model generated invalid JSON syntax")
            correction = kwargs["input"][-1]["content"][0]["text"]
            assert "strict JSON" in correction
            return SimpleNamespace(steps=[], output_text="Recovered response.")

    interactions = Interactions()
    saved = {}
    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(interactions=interactions))
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_args: [])
    monkeypatch.setattr(chatBot, "_save_assistant", lambda _id, _owner, _text, _status, metadata: saved.update(metadata) or 10)
    monkeypatch.setattr(chatBot, "_maybe_summarize", lambda *_args: None)

    events = list(chatBot.stream_coach_turn(1, 1, "test@example.com"))

    assert interactions.calls == 3
    assert saved["malformed_tool_retries"] == 2
    assert events[-1] == {"type": "message.completed", "message_id": 10}


def test_conversation_input_includes_latest_pending_proposal_and_exercise_names(monkeypatch):
    from app import main

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, info={"owner_email": "test@example.com"})
    monkeypatch.setattr(main, "SessionLocal", session_factory)
    monkeypatch.setattr(chatBot, "execute_tool", lambda name, *_args: {name: []})

    with session_factory() as db:
        exercise = main.Exercise(name="Barbell bench press", equipment="Barbell")
        conversation = main.AIConversation(owner_email="test@example.com", title="Coach")
        db.add_all([exercise, conversation]); db.flush()
        db.add(main.AIChangeProposal(
            conversation_id=conversation.id,
            operation="create_routine",
            payload=json.dumps({"name": "Upper A", "exercises": [{"exercise_id": exercise.id, "planned_sets": 3}]}),
            summary="Create Upper A",
            reasoning="Adds upper-body volume.",
            status="pending",
        ))
        db.commit()
        conversation_id = conversation.id
        exercise_id = exercise.id

    content = chatBot._conversation_input(conversation_id, "test@example.com")[0]["content"][0]["text"]
    assert "<latest_pending_proposal" in content
    assert '"name": "Upper A"' in content
    assert f'"{exercise_id}": "Barbell bench press"' in content
    engine.dispose()


def test_provider_rejection_has_logged_reference(monkeypatch):
    class ProviderError(Exception):
        code = 400

    def fail_client():
        raise ProviderError("Invalid request schema")

    saved = {}
    monkeypatch.setattr(chatBot, "_client", fail_client)
    monkeypatch.setattr(chatBot, "_save_assistant", lambda _id, _owner, _text, _status, metadata: saved.update(metadata))
    events = list(chatBot.stream_coach_turn(12, 34, "test@example.com"))
    error = events[-1]
    assert error["type"] == "error"
    assert saved["error_ref"] in error["message"]
    assert "backend/logs/coach.log" in error["message"]
    assert f"ref={saved['error_ref']}" in Path(chatBot.LOGGER.handlers[0].baseFilename).read_text(encoding="utf-8")


def test_cancel_after_provider_response_prevents_tool_execution(monkeypatch):
    class FunctionCall:
        def model_dump(self, **_kwargs):
            return {"type": "function_call", "name": "propose_create_routine", "id": "call-1", "arguments": {}}

    monkeypatch.setattr(chatBot, "_client", lambda: SimpleNamespace(
        interactions=SimpleNamespace(create=lambda **_kwargs: SimpleNamespace(steps=[FunctionCall()], output_text=""))
    ))
    monkeypatch.setattr(chatBot, "_conversation_input", lambda *_args: [])
    executed = []
    monkeypatch.setattr(chatBot, "execute_tool", lambda *_args: executed.append(True))
    saved = {}
    monkeypatch.setattr(chatBot, "_mark_interrupted", lambda _id, _owner, text: saved.update(text=text))

    checks = iter([False, True])
    events = list(chatBot.stream_coach_turn(1, 1, "test@example.com", is_cancelled=lambda: next(checks)))

    assert executed == []
    assert saved["text"] == "Response stopped."
    assert events[-1] == {"type": "message.interrupted"}


def test_routine_update_keeps_folder_unless_explicitly_removed(monkeypatch):
    from app import main
    from app.tools import execute_tool

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, info={"owner_email": "test@example.com"})
    monkeypatch.setattr(main, "SessionLocal", session_factory)
    with session_factory() as db:
        folder = main.RoutineFolder(name="Training")
        exercise = main.Exercise(name="Lateral raise", equipment="Dumbbell")
        db.add_all([folder, exercise]); db.flush()
        routine = main.Routine(name="Upper", folder_id=folder.id)
        routine.exercises.append(main.RoutineExercise(exercise_id=exercise.id, position=0, planned_sets=3))
        conversation = main.AIConversation(owner_email="test@example.com", title="Coach")
        db.add_all([routine, conversation]); db.commit()
        folder_id, exercise_id, routine_id, conversation_id = folder.id, exercise.id, routine.id, conversation.id

    proposed = execute_tool("propose_update_routine", {
        "routine_id": routine_id,
        "routine": {"name": "Upper", "exercises": [{"exercise_id": exercise_id, "planned_sets": 5}]},
        "summary": "Add lateral raise sets",
        "reasoning": "The current three sets leave room for a gradual increase based on recent training.",
    }, conversation_id, None, "test@example.com")
    with session_factory() as db:
        proposal = db.get(main.AIChangeProposal, proposed["proposal_id"])
        message = main.AIMessage(conversation_id=conversation_id, role="assistant", content="Proposal ready", status="completed")
        db.add(message); db.flush(); proposal.message_id = message.id; db.commit()
        assert json.loads(proposal.payload)["folder_id"] == folder_id
        assert json.loads(proposal.payload)["_folder_id_explicit"] is False
        assert main.ai_proposal_out(proposal)["reasoning"] == "The current three sets leave room for a gradual increase based on recent training."
        assert main.ai_proposal_out(proposal)["message_id"] == message.id
        main.confirm_ai_proposal(proposal.id, main.ActorContext(owner_email="test@example.com"), db)
        db.refresh(db.get(main.Routine, routine_id))
        assert db.get(main.Routine, routine_id).folder_id == folder_id

    removal = execute_tool("propose_update_routine", {
        "routine_id": routine_id,
        "routine": {"name": "Upper", "folder_id": None, "exercises": [{"exercise_id": exercise_id, "planned_sets": 5}]},
        "summary": "Move routine out of its folder",
    }, conversation_id, None, "test@example.com")
    with session_factory() as db:
        proposal = db.get(main.AIChangeProposal, removal["proposal_id"])
        assert json.loads(proposal.payload)["_folder_id_explicit"] is True
        main.confirm_ai_proposal(proposal.id, main.ActorContext(owner_email="test@example.com"), db)
        assert db.get(main.Routine, routine_id).folder_id is None

    engine.dispose()


def test_program_proposal_creates_folder_routines_and_calendar_together(monkeypatch):
    from app import main
    from app.tools import execute_tool

    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    main.Base.metadata.create_all(engine)
    session_factory = sessionmaker(bind=engine, autoflush=False, info={"owner_email": "test@example.com"})
    monkeypatch.setattr(main, "SessionLocal", session_factory)
    with session_factory() as db:
        exercise = main.Exercise(name="Squat", equipment="Barbell")
        conversation = main.AIConversation(owner_email="test@example.com", title="Coach")
        db.add_all([exercise, conversation]); db.commit()
        exercise_id, conversation_id = exercise.id, conversation.id

    program = {
        "folder_name": "PPL", "routines": [
            {"name": name, "exercises": [{"exercise_id": exercise_id, "planned_sets": 3}]}
            for name in ("Push", "Pull", "Legs")
        ],
        "weekly_plan": {"name": "PPL week", "starts_on": "2026-09-28", "days": [
            {"weekday": 0, "routine_index": 0}, {"weekday": 2, "routine_index": 1}, {"weekday": 4, "routine_index": 2},
        ]},
        "dates": [{"date": "2026-09-29", "routine_index": 2}],
    }
    bad = execute_tool("propose_create_training_program", {"program": {**program, "dates": [{"date": "2026-09-29", "routine_index": 3}]}, "summary": "Bad"}, conversation_id, None, "test@example.com")
    assert "error" in bad
    result = execute_tool("propose_create_training_program", {"program": program, "summary": "Build PPL", "reasoning": "Three days fit the requested split."}, conversation_id, None, "test@example.com")
    with session_factory() as db:
        assert db.query(main.RoutineFolder).count() == 0
        assert db.query(main.Routine).count() == 0
        proposal = db.get(main.AIChangeProposal, result["proposal_id"])
        main.confirm_ai_proposal(proposal.id, main.ActorContext(owner_email="test@example.com"), db)
        folder = db.query(main.RoutineFolder).one()
        assert folder.name == "PPL"
        assert {routine.name for routine in folder.routines} == {"Push", "Pull", "Legs"}
        days = main.calendar_month(2026, 9, db)["days"]
        by_date = {item["date"].isoformat(): item for item in days}
        assert by_date["2026-09-28"]["routine_name"] == "Push"
        assert by_date["2026-09-29"]["routine_name"] == "Legs"
        assert by_date["2026-09-30"]["routine_name"] == "Pull"
    engine.dispose()

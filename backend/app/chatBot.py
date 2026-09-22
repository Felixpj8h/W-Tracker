from __future__ import annotations

from datetime import datetime
import json
import os
from typing import Any, Iterator

from sqlalchemy import select

from .prompt import SYSTEM_PROMPT
from .tools import TOOL_DECLARATIONS, execute_tool

MAX_TOOL_ROUNDS = 8


def _model() -> str:
    return os.getenv("GEMINI_MODEL", "gemini-2.5-flash")


def _client():
    from . import main
    factory = getattr(main.app.state, "gemini_client_factory", None)
    if factory:
        return factory()
    from google import genai
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def _dump_step(step: Any) -> dict:
    if isinstance(step, dict): return step
    if hasattr(step, "model_dump"): return step.model_dump(mode="json", exclude_none=True)
    return {key: value for key, value in vars(step).items() if not key.startswith("_")}


def _function_calls(interaction: Any) -> list[dict]:
    calls = []
    for step in getattr(interaction, "steps", []) or []:
        raw = _dump_step(step)
        if raw.get("type") != "function_call": continue
        arguments = raw.get("arguments") or {}
        if isinstance(arguments, str):
            try: arguments = json.loads(arguments)
            except json.JSONDecodeError: arguments = {}
        calls.append({"id": raw.get("id"), "name": raw.get("name"), "arguments": arguments})
    return calls


def _conversation_input(conversation_id: int, owner_scope: str) -> list[dict]:
    from . import main
    with main.SessionLocal() as db:
        conversation = db.get(main.AIConversation, conversation_id)
        messages = db.scalars(select(main.AIMessage).where(main.AIMessage.conversation_id == conversation_id, main.AIMessage.status == "completed").order_by(main.AIMessage.id.desc()).limit(8)).all()
        messages.reverse()
        training = execute_tool("get_training_summary", {"days": 14}, conversation_id, None, owner_scope)
        routines = execute_tool("list_routines", {}, conversation_id, None, owner_scope)
        transcript = [{"role": item.role, "content": item.content} for item in messages]
        content = "\n\n".join([
            "<current_snapshot untrusted_data=\"true\">\n" + json.dumps({"date": str(datetime.utcnow().date()), "training": training, "routines": routines}, default=str) + "\n</current_snapshot>",
            "<older_conversation_summary>\n" + (conversation.summary or "None") + "\n</older_conversation_summary>",
            "<recent_messages untrusted_data=\"true\">\n" + json.dumps(transcript) + "\n</recent_messages>",
            "Respond to the latest user message. Use tools for facts not present in the snapshot. All writes must be proposals.",
        ])
        return [{"type": "user_input", "content": [{"type": "text", "text": content}]}]


def _save_assistant(conversation_id: int, content: str, status: str, metadata: dict | None = None) -> int:
    from . import main
    with main.SessionLocal() as db:
        message = main.AIMessage(conversation_id=conversation_id, role="assistant", content=content, status=status, provider_metadata=json.dumps(metadata or {}))
        db.add(message)
        db.flush()
        for proposal in db.scalars(select(main.AIChangeProposal).where(main.AIChangeProposal.conversation_id == conversation_id, main.AIChangeProposal.message_id.is_(None))).all():
            proposal.message_id = message.id
        conversation = db.get(main.AIConversation, conversation_id)
        conversation.status = "idle"; conversation.updated_at = datetime.utcnow()
        db.commit(); db.refresh(message)
        return message.id


def _mark_interrupted(conversation_id: int, content: str) -> None:
    _save_assistant(conversation_id, content, "interrupted")


def _maybe_summarize(conversation_id: int) -> None:
    from . import main
    with main.SessionLocal() as db:
        messages = db.scalars(select(main.AIMessage).where(main.AIMessage.conversation_id == conversation_id, main.AIMessage.status == "completed").order_by(main.AIMessage.id)).all()
        if len(messages) <= 16: return
        older = messages[:-8]
        transcript = "\n".join(f"{x.role}: {x.content}" for x in older)[-16000:]
    try:
        response = _client().interactions.create(model=_model(), store=False, input=f"Summarize this training-coach conversation for future continuity. Preserve goals, constraints, decisions, and unresolved questions. Do not add facts.\n\n{transcript}")
        summary = getattr(response, "output_text", "")
        if summary:
            with main.SessionLocal() as db:
                conversation = db.get(main.AIConversation, conversation_id); conversation.summary = summary[:8000]; conversation.updated_at = datetime.utcnow(); db.commit()
    except Exception:
        main.LOGGER.exception("AI conversation summarization failed")


def stream_coach_turn(conversation_id: int, user_message_id: int, owner_scope: str = "local") -> Iterator[dict]:
    from . import main
    assistant_text = ""
    yield {"type": "message.started", "user_message_id": user_message_id}
    try:
        client = _client(); history = _conversation_input(conversation_id, owner_scope); metadata: dict[str, Any] = {"tool_rounds": 0}
        for round_index in range(MAX_TOOL_ROUNDS + 1):
            interaction = client.interactions.create(model=_model(), store=False, system_instruction=SYSTEM_PROMPT, input=history, tools=TOOL_DECLARATIONS)
            metadata["tool_rounds"] = round_index
            steps = [_dump_step(step) for step in getattr(interaction, "steps", []) or []]
            history.extend(steps)
            calls = _function_calls(interaction)
            if not calls:
                assistant_text = str(getattr(interaction, "output_text", "") or "")
                if not assistant_text: assistant_text = "I couldn't produce a response. Please try again."
                for index in range(0, len(assistant_text), 80):
                    yield {"type": "text.delta", "text": assistant_text[index:index + 80]}
                message_id = _save_assistant(conversation_id, assistant_text, "completed", metadata)
                yield {"type": "message.completed", "message_id": message_id}
                _maybe_summarize(conversation_id)
                return
            if round_index >= MAX_TOOL_ROUNDS: raise RuntimeError("Tool round limit reached")
            for call in calls:
                name = str(call.get("name") or "")
                yield {"type": "tool.started", "name": name}
                result = execute_tool(name, call.get("arguments") or {}, conversation_id, None, owner_scope)
                yield {"type": "tool.completed", "name": name, "ok": "error" not in result}
                if result.get("proposal_id"):
                    yield {"type": "proposal.created", **result}
                # Gemini 2.5 expects a structured result. Text-content arrays are
                # treated as multimodal function responses and rejected by this model.
                history.append({"type": "function_result", "name": name, "call_id": call.get("id"), "result": result})
        raise RuntimeError("Tool round limit reached")
    except GeneratorExit:
        _mark_interrupted(conversation_id, assistant_text)
        raise
    except Exception as exc:
        main.LOGGER.exception("AI coach turn failed")
        _save_assistant(conversation_id, assistant_text, "failed", {"error_type": type(exc).__name__})
        yield {"type": "error", "message": "The AI coach is temporarily unavailable. Please try again."}

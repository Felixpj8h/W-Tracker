from __future__ import annotations

from datetime import datetime
import json
import os
from threading import Event, Lock
from uuid import uuid4
from typing import Any, Callable, Iterator

from sqlalchemy import select

from .prompt import SYSTEM_PROMPT
from .tools import TOOL_DECLARATIONS, execute_tool
from .coach_logging import LOGGER

MAX_TOOL_ROUNDS = 8
# A complete training-program tool call can contain seven routines and dozens of
# exercise prescriptions.  A 2K cap can truncate that JSON before Gemini has a
# chance to close it, which the provider reports as `malformed_tool_call`.
DEFAULT_MAX_OUTPUT_TOKENS = 8192
PROPOSAL_REPLY_MAX_OUTPUT_TOKENS = 128
MAX_MALFORMED_TOOL_RETRIES = 2
_CANCEL_LOCK = Lock()
_ACTIVE_CANCELS: dict[int, Event] = {}


def begin_cancel_scope(conversation_id: int) -> Event:
    event = Event()
    with _CANCEL_LOCK:
        _ACTIVE_CANCELS[conversation_id] = event
    return event


def request_cancel(conversation_id: int) -> bool:
    with _CANCEL_LOCK:
        event = _ACTIVE_CANCELS.get(conversation_id)
    if not event:
        return False
    event.set()
    return True


def end_cancel_scope(conversation_id: int, event: Event) -> None:
    with _CANCEL_LOCK:
        if _ACTIVE_CANCELS.get(conversation_id) is event:
            _ACTIVE_CANCELS.pop(conversation_id, None)


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


def _is_malformed_tool_call(error: Exception) -> bool:
    """Recognize Gemini's recoverable tool-argument serialization failure."""
    code = getattr(error, "code", None) or getattr(error, "status_code", None)
    details = f"{error} {getattr(error, 'body', '')}".lower()
    return code == 400 and ("malformed_tool_call" in details or "invalid json syntax" in details)


def _conversation_input(conversation_id: int, owner_email: str) -> list[dict]:
    from . import main
    with main.SessionLocal(info={"owner_email": owner_email}) as db:
        conversation = db.get(main.AIConversation, conversation_id)
        if not conversation:
            raise ValueError("Conversation not found")
        messages = db.scalars(select(main.AIMessage).where(main.AIMessage.conversation_id == conversation_id, main.AIMessage.status == "completed").order_by(main.AIMessage.id.desc()).limit(8)).all()
        messages.reverse()
        training = execute_tool("get_training_summary", {"days": 14}, conversation_id, None, owner_email)
        routines = execute_tool("list_routines", {}, conversation_id, None, owner_email)
        pending = db.scalar(
            select(main.AIChangeProposal)
            .where(
                main.AIChangeProposal.conversation_id == conversation_id,
                main.AIChangeProposal.status == "pending",
            )
            .order_by(main.AIChangeProposal.id.desc())
            .limit(1)
        )
        pending_context = None
        if pending:
            payload = json.loads(pending.payload)

            def exercise_ids(value: Any) -> set[int]:
                if isinstance(value, dict):
                    own = {value["exercise_id"]} if isinstance(value.get("exercise_id"), int) else set()
                    return own.union(*(exercise_ids(item) for item in value.values()))
                if isinstance(value, list):
                    return set().union(*(exercise_ids(item) for item in value))
                return set()

            ids = exercise_ids(payload)
            names = {
                item.id: item.name
                for item in db.scalars(select(main.Exercise).where(main.Exercise.id.in_(ids))).all()
            } if ids else {}
            pending_context = {
                "operation": pending.operation,
                "summary": pending.summary,
                "reasoning": pending.reasoning,
                "payload": payload,
                "exercise_names_by_id": names,
            }
        transcript = [{"role": item.role, "content": item.content} for item in messages]
        content = "\n\n".join([
            "<current_snapshot untrusted_data=\"true\">\n" + json.dumps({"date": str(datetime.utcnow().date()), "training": training, "routines": routines}, default=str) + "\n</current_snapshot>",
            "<latest_pending_proposal untrusted_data=\"true\">\n" + json.dumps(pending_context, default=str) + "\n</latest_pending_proposal>",
            "<older_conversation_summary>\n" + (conversation.summary or "None") + "\n</older_conversation_summary>",
            "<recent_messages untrusted_data=\"true\">\n" + json.dumps(transcript) + "\n</recent_messages>",
            "Respond to the latest user message. Use tools for facts not present in the snapshot. All writes must be proposals.",
        ])
        return [{"type": "user_input", "content": [{"type": "text", "text": content}]}]


def _save_assistant(conversation_id: int, owner_email: str, content: str, status: str, metadata: dict | None = None) -> int:
    from . import main
    with main.SessionLocal(info={"owner_email": owner_email}) as db:
        conversation = db.get(main.AIConversation, conversation_id)
        if not conversation:
            raise ValueError("Conversation not found")
        message = main.AIMessage(conversation_id=conversation_id, role="assistant", content=content, status=status, provider_metadata=json.dumps(metadata or {}))
        db.add(message)
        db.flush()
        for proposal in db.scalars(select(main.AIChangeProposal).where(main.AIChangeProposal.conversation_id == conversation_id, main.AIChangeProposal.message_id.is_(None))).all():
            proposal.message_id = message.id
        conversation.status = "idle"; conversation.updated_at = datetime.utcnow()
        db.commit(); db.refresh(message)
        return message.id


def _mark_interrupted(conversation_id: int, owner_email: str, content: str) -> None:
    _save_assistant(conversation_id, owner_email, content, "interrupted")


def _maybe_summarize(conversation_id: int, owner_email: str) -> None:
    from . import main
    with main.SessionLocal(info={"owner_email": owner_email}) as db:
        messages = db.scalars(select(main.AIMessage).where(main.AIMessage.conversation_id == conversation_id, main.AIMessage.status == "completed").order_by(main.AIMessage.id)).all()
        if len(messages) <= 16: return
        older = messages[:-8]
        transcript = "\n".join(f"{x.role}: {x.content}" for x in older)[-16000:]
    try:
        response = _client().interactions.create(model=_model(), store=False, input=f"Summarize this training-coach conversation for future continuity. Preserve goals, constraints, decisions, and unresolved questions. Do not add facts.\n\n{transcript}")
        summary = getattr(response, "output_text", "")
        if summary:
            with main.SessionLocal(info={"owner_email": owner_email}) as db:
                conversation = db.get(main.AIConversation, conversation_id); conversation.summary = summary[:8000]; conversation.updated_at = datetime.utcnow(); db.commit()
    except Exception:
        LOGGER.exception("AI conversation summarization failed conversation_id=%s", conversation_id)


def stream_coach_turn(conversation_id: int, user_message_id: int, owner_email: str, is_cancelled: Callable[[], bool] | None = None) -> Iterator[dict]:
    from . import main
    assistant_text = ""
    round_index = -1
    yield {"type": "message.started", "user_message_id": user_message_id}
    try:
        client = _client(); history = _conversation_input(conversation_id, owner_email); metadata: dict[str, Any] = {"tool_rounds": 0}
        proposal_created = False
        for round_index in range(MAX_TOOL_ROUNDS + 1):
            if is_cancelled and is_cancelled():
                _mark_interrupted(conversation_id, owner_email, assistant_text or "Response stopped.")
                yield {"type": "message.interrupted"}
                return
            request: dict[str, Any] = {
                "model": _model(),
                "store": False,
                "system_instruction": SYSTEM_PROMPT,
                "input": history,
                "generation_config": {
                    "max_output_tokens": PROPOSAL_REPLY_MAX_OUTPUT_TOKENS if proposal_created else DEFAULT_MAX_OUTPUT_TOKENS,
                },
            }
            # Once a mutation proposal exists, the detailed confirmation card
            # contains the answer. Omitting tool schemas makes the final,
            # one-sentence acknowledgement both cheaper and less repetitive.
            if not proposal_created:
                request["tools"] = TOOL_DECLARATIONS
            interaction = None
            for provider_attempt in range(MAX_MALFORMED_TOOL_RETRIES + 1):
                try:
                    interaction = client.interactions.create(**request)
                    break
                except Exception as error:
                    if provider_attempt >= MAX_MALFORMED_TOOL_RETRIES or not _is_malformed_tool_call(error):
                        raise
                    metadata["malformed_tool_retries"] = metadata.get("malformed_tool_retries", 0) + 1
                    history.append({
                        "type": "user_input",
                        "content": [{
                            "type": "text",
                            "text": (
                                "Your previous tool call could not be parsed because its arguments were not valid JSON. "
                                "Retry the same step now. Emit exactly one tool call whose arguments are strict JSON "
                                "matching the declared schema: double-quoted keys and strings, no comments, no trailing "
                                "commas, and no text outside the tool call."
                            ),
                        }],
                    })
                    request["input"] = history
                    LOGGER.warning(
                        "Retrying malformed AI tool call conversation_id=%s user_message_id=%s round=%s",
                        conversation_id,
                        user_message_id,
                        round_index,
                    )
            if interaction is None:
                raise RuntimeError("AI provider returned no interaction")
            if is_cancelled and is_cancelled():
                _mark_interrupted(conversation_id, owner_email, assistant_text or "Response stopped.")
                yield {"type": "message.interrupted"}
                return
            metadata["tool_rounds"] = round_index
            steps = [_dump_step(step) for step in getattr(interaction, "steps", []) or []]
            history.extend(steps)
            calls = _function_calls(interaction)
            if not calls:
                assistant_text = str(getattr(interaction, "output_text", "") or "")
                if not assistant_text: assistant_text = "I couldn't produce a response. Please try again."
                for index in range(0, len(assistant_text), 80):
                    yield {"type": "text.delta", "text": assistant_text[index:index + 80]}
                message_id = _save_assistant(conversation_id, owner_email, assistant_text, "completed", metadata)
                yield {"type": "message.completed", "message_id": message_id}
                _maybe_summarize(conversation_id, owner_email)
                return
            if round_index >= MAX_TOOL_ROUNDS: raise RuntimeError("Tool round limit reached")
            for call in calls:
                if is_cancelled and is_cancelled():
                    _mark_interrupted(conversation_id, owner_email, assistant_text or "Response stopped.")
                    yield {"type": "message.interrupted"}
                    return
                name = str(call.get("name") or "")
                yield {"type": "tool.started", "name": name}
                result = execute_tool(name, call.get("arguments") or {}, conversation_id, None, owner_email)
                yield {"type": "tool.completed", "name": name, "ok": "error" not in result}
                if result.get("proposal_id"):
                    proposal_created = True
                    yield {"type": "proposal.created", **result}
                # Send a structured JSON object, not a list of content parts.
                # Gemini 2.5 treats a content-part list as a multimodal function
                # response and rejects it for this model with HTTP 400.
                history.append({
                    "type": "function_result",
                    "name": name,
                    "call_id": call.get("id"),
                    "result": json.loads(json.dumps(result, default=str)),
                    "is_error": "error" in result,
                })
        raise RuntimeError("Tool round limit reached")
    except GeneratorExit:
        _mark_interrupted(conversation_id, owner_email, assistant_text)
        raise
    except Exception as exc:
        reference = uuid4().hex[:10]
        code = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        LOGGER.exception("AI coach turn failed ref=%s conversation_id=%s user_message_id=%s model=%s round=%s error_type=%s provider_code=%s", reference, conversation_id, user_message_id, _model(), round_index, type(exc).__name__, code)
        _save_assistant(conversation_id, owner_email, assistant_text or f"Unable to complete this response. Error reference: {reference}.", "failed", {"error_type": type(exc).__name__, "error_ref": reference, "provider_code": code, "tool_round": round_index})
        if code == 400:
            message = "The AI provider rejected this request."
        elif code in (429, 503):
            message = "The AI provider is busy right now. Please try again shortly."
        else:
            message = "The AI coach could not complete this response."
        yield {"type": "error", "message": f"{message} Error reference: {reference}. Details are in backend/logs/coach.log."}

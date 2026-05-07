import json
import os
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack
from typing import Any, Literal

from agents import Agent, ModelSettings, Runner
from agents.items import ToolCallItem, ToolCallOutputItem
from agents.mcp import MCPServerStreamableHttp
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from openai.types.responses import (
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseReasoningTextDeltaEvent,
    ResponseTextDeltaEvent,
)
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from financial_agents import FinancialAnalysisRequest, run_financial_analysis
from skill_agents import (
    AgenticTaskRequest,
    SkillCreate,
    SkillDraftRequest,
    SkillDraftResponse,
    SkillRead,
    SkillUpdate,
    build_skill_draft,
    run_agentic_task,
)
from skill_agents.db import get_session, initialize_database
from skill_agents.models import Skill

load_dotenv()

ARITHMETIC_MCP_SERVER_NAME = "arithmetic-mcp-fastmcp"
TWSTOCK_MCP_SERVER_NAME = "twstock-mcp-fastmcp"
DEFAULT_ARITHMETIC_MCP_URL = "http://arithmetic-mcp-fastmcp:8080/mcp"
DEFAULT_TWSTOCK_MCP_URL = "http://twstock-mcp-fastmcp:8081/mcp"


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(default_factory=list)


class OpenAIKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1)


app = FastAPI(title="Arithmetic MCP Chat API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ALLOW_ORIGINS", "*").split(","),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    if os.getenv("SKILLS_DB_AUTO_INIT", "true").lower() == "true":
        initialize_database()


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/settings/openai-key")
async def openai_key_status() -> dict[str, bool]:
    return {"configured": openai_api_key_configured()}


@app.post("/api/settings/openai-key")
async def set_openai_key(payload: OpenAIKeyRequest) -> dict[str, bool]:
    api_key = payload.api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="API key is required.")
    os.environ["OPENAI_API_KEY"] = api_key
    return {"configured": True}


@app.get("/api/mcp/tools")
async def mcp_tools() -> dict[str, Any]:
    async with AsyncExitStack() as stack:
        servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
        server_tools = []
        for server in servers:
            tools = await server.list_tools()
            server_tools.append(
                {
                    "server": server.name,
                    "tools": [
                        {
                            "name": tool.name,
                            "description": tool.description,
                            "input_schema": tool.inputSchema,
                        }
                        for tool in tools
                    ],
                }
            )
        return {"servers": server_tools}


@app.post("/api/chat/stream")
async def chat_stream(request: ChatRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_agent_events(request.messages),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/financial-analysis/stream")
async def financial_analysis_stream(request: FinancialAnalysisRequest) -> StreamingResponse:
    return StreamingResponse(
        stream_financial_analysis_events(request.stock, request.question, request.context),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/skills", response_model=list[SkillRead])
async def list_skills(session: Session = Depends(get_session)) -> list[Skill]:
    return list(session.scalars(select(Skill).where(Skill.is_active.is_(True)).order_by(Skill.created_at, Skill.name)))


@app.post("/api/skills", response_model=SkillRead, status_code=status.HTTP_201_CREATED)
async def create_skill(payload: SkillCreate, session: Session = Depends(get_session)) -> Skill:
    skill = Skill(**payload.model_dump())
    session.add(skill)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail="A skill with this name already exists.") from exc
    session.refresh(skill)
    return skill


@app.put("/api/skills/{skill_id}", response_model=SkillRead)
async def update_skill(skill_id: str, payload: SkillUpdate, session: Session = Depends(get_session)) -> Skill:
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found.")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(skill, key, value)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail="A skill with this name already exists.") from exc
    session.refresh(skill)
    return skill


@app.delete("/api/skills/{skill_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill(skill_id: str, session: Session = Depends(get_session)) -> None:
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(status_code=404, detail="Skill not found.")
    skill.is_active = False
    session.commit()


@app.post("/api/skills/draft", response_model=SkillDraftResponse)
async def draft_skill(payload: SkillDraftRequest) -> dict[str, str]:
    if not openai_api_key_configured():
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY is not set on the backend service.")

    try:
        async with AsyncExitStack() as stack:
            mcp_servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
            return await build_skill_draft(payload.prompt, mcp_servers, context=payload.context)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/agentic-task/stream")
async def agentic_task_stream(
    request: AgenticTaskRequest,
    session: Session = Depends(get_session),
) -> StreamingResponse:
    required_skills, active_skills = load_agentic_skills(session, request.required_skill_ids)
    return StreamingResponse(
        stream_agentic_task_events(request, required_skills, active_skills),
        media_type="application/x-ndjson",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


def build_mcp_servers() -> list[MCPServerStreamableHttp]:
    return [
        MCPServerStreamableHttp(
            params={"url": os.getenv("MCP_HTTP_URL", DEFAULT_ARITHMETIC_MCP_URL)},
            name=ARITHMETIC_MCP_SERVER_NAME,
            cache_tools_list=False,
            use_structured_content=True,
            client_session_timeout_seconds=15,
        ),
        MCPServerStreamableHttp(
            params={"url": os.getenv("TWSTOCK_MCP_HTTP_URL", DEFAULT_TWSTOCK_MCP_URL)},
            name=TWSTOCK_MCP_SERVER_NAME,
            cache_tools_list=False,
            use_structured_content=True,
            client_session_timeout_seconds=30,
        ),
    ]


def openai_api_key_configured() -> bool:
    return bool(os.getenv("OPENAI_API_KEY"))


def load_agentic_skills(session: Session, skill_ids: list[str]) -> tuple[list[Skill], list[Skill]]:
    unique_ids = list(dict.fromkeys(skill_ids))
    active_skills = list(session.scalars(select(Skill).where(Skill.is_active.is_(True)).order_by(Skill.created_at, Skill.name)))
    by_id = {skill.id: skill for skill in active_skills}
    missing_ids = [skill_id for skill_id in unique_ids if skill_id not in by_id]
    if missing_ids:
        raise HTTPException(status_code=400, detail=f"Unknown or inactive skill IDs: {', '.join(missing_ids)}")
    return [by_id[skill_id] for skill_id in unique_ids], active_skills


async def stream_agent_events(messages: list[ChatMessage]) -> AsyncIterator[str]:
    if not openai_api_key_configured():
        yield encode_event(
            "error",
            {
                "message": "OPENAI_API_KEY is not set on the backend service.",
            },
        )
        return

    try:
        async with AsyncExitStack() as stack:
            mcp_servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
            for server in mcp_servers:
                tools = await server.list_tools()
                yield encode_event(
                    "mcp_ready",
                    {
                        "server": server.name,
                        "tools": [tool.name for tool in tools],
                    },
                )

            chat_model = os.getenv("OPENAI_MODEL", "gpt-5-mini")
            chat_settings = (
                ModelSettings(reasoning={"effort": "low"})
                if chat_model.startswith(("gpt-5", "o3", "o4"))
                else ModelSettings()
            )

            agent = Agent(
                name="MCP Chat Agent",
                instructions=(
                    "You are a concise assistant with MCP tools. Use the arithmetic MCP tools "
                    "for addition, subtraction, multiplication, and division. Use the twstock "
                    "MCP tools for Taiwan stock metadata, realtime quotes, historical OHLC data, "
                    "moving averages, and Best Four Point technical signals. Explain tool-derived "
                    "results briefly and mention when market data may be unavailable, delayed, or "
                    "rate limited. The chat history is provided as numbered rounds. For cumulative "
                    "questions like 'what do the current calculations add up to', use each prior "
                    "round's final answer as the remembered value. Do not add intermediate values "
                    "from prior explanations unless the user explicitly asks for intermediate values."
                ),
                model=chat_model,
                model_settings=chat_settings,
                mcp_servers=mcp_servers,
            )

            result = Runner.run_streamed(agent, input=conversation_prompt(messages))
            async for event in result.stream_events():
                async for normalized in normalize_agent_event(event):
                    yield encode_event(normalized["type"], normalized["payload"])

            yield encode_event("done", {})
    except Exception as exc:
        yield encode_event("error", {"message": str(exc)})


async def stream_financial_analysis_events(
    stock: str,
    question: str | None = None,
    context: str | None = None,
) -> AsyncIterator[str]:
    if not openai_api_key_configured():
        yield encode_event(
            "error",
            {
                "message": "OPENAI_API_KEY is not set on the backend service.",
            },
        )
        return

    try:
        async with AsyncExitStack() as stack:
            mcp_servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
            for server in mcp_servers:
                tools = await server.list_tools()
                yield encode_event(
                    "mcp_ready",
                    {
                        "server": server.name,
                        "tools": [tool.name for tool in tools],
                    },
                )

            async for event in run_financial_analysis(stock, mcp_servers, question=question, context=context):
                yield encode_event(event["type"], event["payload"])

            yield encode_event("done", {})
    except Exception as exc:
        yield encode_event("error", {"message": str(exc)})


async def stream_agentic_task_events(
    request: AgenticTaskRequest,
    required_skills: list[Skill],
    active_skills: list[Skill],
) -> AsyncIterator[str]:
    if not openai_api_key_configured():
        yield encode_event(
            "error",
            {
                "message": "OPENAI_API_KEY is not set on the backend service.",
            },
        )
        return

    try:
        async with AsyncExitStack() as stack:
            mcp_servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
            for server in mcp_servers:
                tools = await server.list_tools()
                yield encode_event(
                    "mcp_ready",
                    {
                        "server": server.name,
                        "tools": [tool.name for tool in tools],
                    },
                )

            async for event in run_agentic_task(
                request.prompt,
                required_skills,
                active_skills,
                mcp_servers,
                stock=request.stock,
                context=request.context,
            ):
                yield encode_event(event["type"], event["payload"])

            yield encode_event("done", {})
    except Exception as exc:
        yield encode_event("error", {"message": str(exc)})


async def normalize_agent_event(event: Any) -> AsyncIterator[dict[str, Any]]:
    if event.type == "raw_response_event":
        data = event.data
        if isinstance(data, ResponseTextDeltaEvent):
            yield {"type": "text_delta", "payload": {"delta": data.delta}}
            return

        if isinstance(data, (ResponseReasoningTextDeltaEvent, ResponseReasoningSummaryTextDeltaEvent)):
            yield {"type": "reasoning_delta", "payload": {"delta": data.delta}}
            return

        event_type = getattr(data, "type", data.__class__.__name__)
        if "reasoning" in event_type:
            yield {
                "type": "reasoning_event",
                "payload": {"event_type": event_type, "data": to_jsonable(data)},
            }
        return

    if event.type == "run_item_stream_event":
        if "reasoning" in event.name:
            yield {
                "type": "reasoning_event",
                "payload": {"event_type": event.name, "item": to_jsonable(event.item)},
            }
            return

        if event.name == "tool_called" and isinstance(event.item, ToolCallItem):
            yield {
                "type": "tool_called",
                "payload": {"item": to_jsonable(event.item.raw_item)},
            }
            return

        if event.name == "tool_output" and isinstance(event.item, ToolCallOutputItem):
            yield {
                "type": "tool_output",
                "payload": {"output": to_jsonable(event.item.output)},
            }
            return

        yield {
            "type": "agent_event",
            "payload": {"name": event.name, "item": to_jsonable(event.item)},
        }


def conversation_prompt(messages: list[ChatMessage]) -> str:
    if not messages:
        return "Use the MCP tools to calculate (18 + 24) * 3, then divide the result by 7."

    rounds: list[tuple[str, str | None]] = []
    pending_user: str | None = None
    for message in messages:
        content = message.content.strip()
        if not content:
            continue
        if message.role == "user":
            if pending_user is not None:
                rounds.append((pending_user, None))
            pending_user = content
            continue
        if message.role == "assistant" and pending_user is not None:
            rounds.append((pending_user, content))
            pending_user = None

    if pending_user is not None:
        rounds.append((pending_user, None))

    current_user = rounds[-1][0] if rounds else ""
    previous_rounds = rounds[:-1]
    history = "\n\n".join(
        f"Round {index}\nUser: {user}\nAssistant final response: {assistant or '(no assistant response)'}"
        for index, (user, assistant) in enumerate(previous_rounds, start=1)
    )

    return (
        "Continue this chat. Use MCP arithmetic tools whenever the current user asks for arithmetic. "
        "Use MCP twstock tools whenever the current user asks about Taiwan stock metadata, realtime quotes, "
        "historical prices, moving averages, or Best Four Point signals.\n"
        "Previous completed chat rounds are memory. Treat each assistant final response as that round's result.\n"
        "For cumulative totals, add prior rounds' final answers, not intermediate values shown inside explanations.\n\n"
        f"Previous rounds:\n{history or '(none)'}\n\n"
        f"Current user request:\n{current_user}"
    )


def encode_event(event_type: str, payload: dict[str, Any]) -> str:
    return json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n"


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

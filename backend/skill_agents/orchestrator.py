from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from agents import Agent, ImageGenerationTool, ModelSettings, Runner, WebSearchTool
from agents.items import ToolCallItem, ToolCallOutputItem
from agents.mcp import MCPServer
from openai.types.responses import (
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseReasoningTextDeltaEvent,
    ResponseTextDeltaEvent,
)

from financial_agents.orchestrator import _extract_image_payload
from financial_agents.schemas import DISCLAIMER

from .models import Skill


MAX_EXECUTED_SKILLS = 5


@dataclass
class SpecialistResult:
    skill_id: str
    skill_name: str
    output: str
    error: str | None = None


@dataclass
class PlannedSkill:
    skill: Skill
    source: str
    reason: str = ""


@dataclass
class SkillExecutionPlan:
    planned_skills: list[PlannedSkill]
    skipped_skills: list[dict[str, str]]
    no_relevant_skills: bool = False


def agentic_model() -> str:
    return os.getenv("AGENTIC_TASK_MODEL", os.getenv("FINANCIAL_ANALYSIS_MODEL", os.getenv("OPENAI_MODEL", "gpt-5-mini")))


def image_model() -> str:
    return os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")


def _model_settings() -> ModelSettings:
    model = agentic_model()
    if model.startswith(("gpt-5", "o3", "o4")):
        return ModelSettings(reasoning={"effort": "low"})
    return ModelSettings()


def _builtin_tools() -> list[Any]:
    return [
        WebSearchTool(search_context_size=os.getenv("FINANCIAL_ANALYSIS_WEB_CONTEXT", "medium")),  # type: ignore[arg-type]
        ImageGenerationTool(
            tool_config={
                "type": "image_generation",
                "model": image_model(),
                "size": "1024x1024",
                "quality": os.getenv("OPENAI_IMAGE_QUALITY", "low"),
            }
        )
    ]


def build_specialist_agent(skill: Skill, mcp_servers: list[MCPServer]) -> Agent:
    return Agent(
        name=f"SpecialistSkillAgent-{skill.name}",
        instructions=(
            f"{skill.instructions}\n\n"
            "請只回答此技能負責的分析面向。輸出使用 Markdown。"
            "引用來源、列出缺少資料與重要假設。"
            f"涉及投資建議時，最後加入：「{DISCLAIMER}」"
        ),
        model=agentic_model(),
        model_settings=_model_settings(),
        tools=_builtin_tools(),
        mcp_servers=mcp_servers,
    )


def build_manager_agent(mcp_servers: list[MCPServer]) -> Agent:
    return Agent(
        name="ManagerAgent",
        instructions=(
            "你是投資分析任務的 Manager Agent。你會收到多個 specialist agent 的 Markdown 分析。"
            "請整合成單一繁體中文 Markdown 最終答案。"
            "要求：比較不同 specialist 的結論、指出衝突或資料缺口、保留重要來源與假設、"
            "給出清楚但謹慎的結論。不要逐字貼回所有 specialist 內容。"
            f"若內容涉及投資建議，最後加入：「{DISCLAIMER}」"
        ),
        model=agentic_model(),
        model_settings=_model_settings(),
        tools=_builtin_tools(),
        mcp_servers=mcp_servers,
    )


def build_planner_agent(mcp_servers: list[MCPServer]) -> Agent:
    return Agent(
        name="ManagerPlannerAgent",
        instructions=(
            "你是 agentic task 的 Manager Planner。你會收到使用者任務、先前對話摘要、"
            "必跑技能與所有可用技能清單。請判斷哪些非必跑技能也應執行。"
            "只選與任務高度相關的技能；不要為了湊滿數量而選。"
            f"總執行技能數最多 {MAX_EXECUTED_SKILLS} 個，必跑技能優先占用額度。"
            "請只輸出 JSON，不要 Markdown。格式："
            '{"additional_skill_ids":["..."],"skipped_skills":[{"skill_id":"...","reason":"..."}],'
            '"no_relevant_skills":false}'
        ),
        model=agentic_model(),
        model_settings=_model_settings(),
        tools=_builtin_tools(),
        mcp_servers=mcp_servers,
    )


def build_research_agent(mcp_servers: list[MCPServer]) -> Agent:
    return Agent(
        name="ManagerResearchAgent",
        instructions=(
            "你是沒有可用 specialist skill 時的研究型 Manager Agent。"
            "請使用所有可用工具直接回答使用者任務，輸出繁體中文 Markdown。"
            "答案開頭必須明確說明：本次沒有使用任何已儲存技能，因為沒有技能符合任務。"
            "答案結尾請建議使用者建立一個可重用技能，並簡短描述該技能應包含的指令。"
            f"若內容涉及投資建議，最後加入：「{DISCLAIMER}」"
        ),
        model=agentic_model(),
        model_settings=_model_settings(),
        tools=_builtin_tools(),
        mcp_servers=mcp_servers,
    )


def build_skill_prompt_builder_agent(mcp_servers: list[MCPServer]) -> Agent:
    return Agent(
        name="SkillPromptBuilderAgent",
        instructions=(
            "你負責把使用者需求改寫成可重用 agent skill draft。"
            "請只輸出 JSON，不要 Markdown。格式："
            '{"name":"120字以內技能名稱","description":"一行短描述","instructions":"完整繁體中文 specialist 指令"}。'
            "instructions 必須具體說明角色、任務邊界、輸出格式、資料不足時的處理方式與引用要求。"
            "不要自動儲存技能。"
        ),
        model=agentic_model(),
        model_settings=_model_settings(),
        tools=_builtin_tools(),
        mcp_servers=mcp_servers,
    )


async def run_agentic_task(
    prompt: str,
    required_skills: list[Skill],
    active_skills: list[Skill],
    mcp_servers: list[MCPServer],
    stock: str | None = None,
    context: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    results: list[SpecialistResult] = []

    yield {
        "type": "manager_planning_started",
        "payload": {
            "agent": "ManagerPlannerAgent",
            "required_skill_ids": [skill.id for skill in required_skills],
            "candidate_count": len(active_skills),
        },
    }

    try:
        plan = await _plan_skill_execution(prompt, required_skills, active_skills, mcp_servers, stock=stock, context=context)
    except Exception as exc:
        plan = _required_only_plan(required_skills)
        yield {
            "type": "error",
            "payload": {
                "agent": "ManagerPlannerAgent",
                "message": f"Planner failed; falling back to required skills only: {exc}",
            },
        }

    for planned in plan.planned_skills:
        if planned.source == "manager":
            yield {
                "type": "skill_selected_by_manager",
                "payload": {
                    "agent": "ManagerPlannerAgent",
                    "skill_id": planned.skill.id,
                    "skill_name": planned.skill.name,
                    "reason": planned.reason,
                },
            }

    for skipped in plan.skipped_skills:
        yield {
            "type": "skill_skipped_by_manager",
            "payload": {
                "agent": "ManagerPlannerAgent",
                **skipped,
            },
        }

    yield {
        "type": "execution_plan_created",
        "payload": {
            "agent": "ManagerPlannerAgent",
            "skills": [
                {
                    "skill_id": planned.skill.id,
                    "skill_name": planned.skill.name,
                    "source": planned.source,
                    "reason": planned.reason,
                }
                for planned in plan.planned_skills
            ],
            "max_skills": MAX_EXECUTED_SKILLS,
        },
    }

    if plan.no_relevant_skills and not required_skills:
        yield {
            "type": "no_relevant_skills",
            "payload": {
                "agent": "ManagerPlannerAgent",
                "message": "No active skill matched this task. Running a direct manager research response.",
            },
        }
        async for event in _run_research_manager(prompt, mcp_servers, stock=stock, context=context):
            yield event
        return

    skills = [planned.skill for planned in plan.planned_skills]

    yield {
        "type": "manager_started",
        "payload": {
            "agent": "ManagerAgent",
            "detail": f"Running {len(skills)} specialist skill agents",
        },
    }

    async def worker(skill: Skill) -> None:
        try:
            result = await _run_specialist(skill, prompt, mcp_servers, queue, stock=stock, context=context)
            results.append(result)
        except Exception as exc:
            message = str(exc)
            results.append(SpecialistResult(skill_id=skill.id, skill_name=skill.name, output="", error=message))
            await queue.put(
                {
                    "type": "error",
                    "payload": {
                        "agent": skill.name,
                        "skill_id": skill.id,
                        "message": message,
                    },
                }
            )
        finally:
            await queue.put({"type": "_specialist_done", "payload": {"skill_id": skill.id}})

    tasks = [asyncio.create_task(worker(skill)) for skill in skills]
    remaining = len(tasks)
    while remaining:
        event = await queue.get()
        if event["type"] == "_specialist_done":
            remaining -= 1
            continue
        yield event

    await asyncio.gather(*tasks, return_exceptions=True)

    successful = [result for result in results if result.output.strip()]
    if not successful:
        yield {
            "type": "error",
            "payload": {
                "agent": "ManagerAgent",
                "message": "No specialist produced a usable result.",
            },
        }
        return

    async for event in _run_manager(prompt, successful, mcp_servers, stock=stock, context=context):
        yield event


async def _run_specialist(
    skill: Skill,
    prompt: str,
    mcp_servers: list[MCPServer],
    queue: asyncio.Queue[dict[str, Any]],
    stock: str | None = None,
    context: str | None = None,
) -> SpecialistResult:
    await queue.put(
        {
            "type": "specialist_started",
            "payload": {
                "agent": skill.name,
                "skill_id": skill.id,
                "detail": skill.description,
            },
        }
    )

    agent = build_specialist_agent(skill, mcp_servers)
    specialist_prompt = _specialist_prompt(prompt, skill, stock=stock, context=context)
    result = Runner.run_streamed(agent, input=specialist_prompt, max_turns=20)
    text_parts: list[str] = []

    async for event in result.stream_events():
        async for normalized in _normalize_agent_event(event, skill):
            if normalized["type"] == "text_delta":
                text_parts.append(normalized["payload"]["delta"])
                continue
            await queue.put(normalized)

    image = _extract_image_payload(result)
    if image:
        await queue.put(
            {
                "type": "image_generated",
                "payload": {
                    "agent": skill.name,
                    "skill_id": skill.id,
                    "title": f"{skill.name} visualization",
                    "description": "Generated by specialist skill agent.",
                    "image": image,
                },
            }
        )

    output = getattr(result, "final_output", None) or "".join(text_parts)
    await queue.put(
        {
            "type": "specialist_completed",
            "payload": {
                "agent": skill.name,
                "skill_id": skill.id,
                "summary": _summarize_text(output),
            },
        }
    )
    return SpecialistResult(skill_id=skill.id, skill_name=skill.name, output=str(output))


async def _plan_skill_execution(
    prompt: str,
    required_skills: list[Skill],
    active_skills: list[Skill],
    mcp_servers: list[MCPServer],
    stock: str | None = None,
    context: str | None = None,
) -> SkillExecutionPlan:
    required_by_id = {skill.id: skill for skill in required_skills}
    active_by_id = {skill.id: skill for skill in active_skills}
    planner = build_planner_agent(mcp_servers)
    result = Runner.run_streamed(
        planner,
        input=_planner_prompt(prompt, required_skills, active_skills, stock=stock, context=context),
        max_turns=8,
    )
    text_parts: list[str] = []
    async for event in result.stream_events():
        async for normalized in _normalize_common_event(event):
            if normalized["type"] == "text_delta":
                text_parts.append(normalized["payload"]["delta"])

    raw_output = str(getattr(result, "final_output", None) or "".join(text_parts))
    payload = _extract_json_object(raw_output)
    additional_ids = payload.get("additional_skill_ids", [])
    if not isinstance(additional_ids, list):
        additional_ids = []

    planned: list[PlannedSkill] = [
        PlannedSkill(skill=skill, source="required", reason="User selected this required skill.")
        for skill in required_skills[:MAX_EXECUTED_SKILLS]
    ]
    planned_ids = {skill.id for skill in required_skills[:MAX_EXECUTED_SKILLS]}
    available_slots = max(0, MAX_EXECUTED_SKILLS - len(planned))

    skipped: list[dict[str, str]] = []
    for skill_id in additional_ids:
        if not isinstance(skill_id, str) or skill_id in planned_ids:
            continue
        skill = active_by_id.get(skill_id)
        if not skill or skill_id in required_by_id:
            continue
        if available_slots <= 0:
            skipped.append({"skill_id": skill_id, "reason": "Execution limit reached."})
            continue
        planned.append(PlannedSkill(skill=skill, source="manager", reason="Selected by Manager Planner."))
        planned_ids.add(skill_id)
        available_slots -= 1

    raw_skipped = payload.get("skipped_skills", [])
    if isinstance(raw_skipped, list):
        for item in raw_skipped:
            if not isinstance(item, dict):
                continue
            skill_id = item.get("skill_id")
            if not isinstance(skill_id, str) or skill_id in planned_ids:
                continue
            reason = item.get("reason")
            skipped.append(
                {
                    "skill_id": skill_id,
                    "skill_name": active_by_id.get(skill_id).name if skill_id in active_by_id else skill_id,
                    "reason": str(reason or "Not selected by Manager Planner."),
                }
            )

    no_relevant = bool(payload.get("no_relevant_skills")) or not planned
    return SkillExecutionPlan(planned_skills=planned, skipped_skills=skipped, no_relevant_skills=no_relevant)


def _required_only_plan(required_skills: list[Skill]) -> SkillExecutionPlan:
    return SkillExecutionPlan(
        planned_skills=[
            PlannedSkill(skill=skill, source="required", reason="User selected this required skill.")
            for skill in required_skills[:MAX_EXECUTED_SKILLS]
        ],
        skipped_skills=[],
        no_relevant_skills=not required_skills,
    )


async def _run_manager(
    prompt: str,
    results: list[SpecialistResult],
    mcp_servers: list[MCPServer],
    stock: str | None = None,
    context: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    manager = build_manager_agent(mcp_servers)
    manager_prompt = _manager_prompt(prompt, results, stock=stock, context=context)
    result = Runner.run_streamed(manager, input=manager_prompt, max_turns=8)
    async for event in result.stream_events():
        async for normalized in _normalize_manager_event(event, "ManagerAgent"):
            yield normalized
    yield {
        "type": "manager_completed",
        "payload": {
            "agent": "ManagerAgent",
            "summary": "Final synthesis completed",
        },
    }


async def _run_research_manager(
    prompt: str,
    mcp_servers: list[MCPServer],
    stock: str | None = None,
    context: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    agent = build_research_agent(mcp_servers)
    result = Runner.run_streamed(agent, input=_research_prompt(prompt, stock=stock, context=context), max_turns=12)
    async for event in result.stream_events():
        async for normalized in _normalize_manager_event(event, "ManagerResearchAgent"):
            yield normalized
    yield {
        "type": "manager_completed",
        "payload": {
            "agent": "ManagerResearchAgent",
            "summary": "Direct manager research completed",
        },
    }


async def build_skill_draft(
    prompt: str,
    mcp_servers: list[MCPServer],
    context: str | None = None,
) -> dict[str, str]:
    agent = build_skill_prompt_builder_agent(mcp_servers)
    result = Runner.run_streamed(agent, input=_skill_draft_prompt(prompt, context=context), max_turns=8)
    text_parts: list[str] = []
    async for event in result.stream_events():
        async for normalized in _normalize_common_event(event):
            if normalized["type"] == "text_delta":
                text_parts.append(normalized["payload"]["delta"])

    raw_output = str(getattr(result, "final_output", None) or "".join(text_parts))
    payload = _extract_json_object(raw_output)
    return {
        "name": str(payload.get("name") or "新技能草稿")[:120],
        "description": str(payload.get("description") or "由 Skill Prompt Builder 產生的技能草稿。"),
        "instructions": str(payload.get("instructions") or prompt),
    }


def _planner_prompt(
    prompt: str,
    required_skills: list[Skill],
    active_skills: list[Skill],
    stock: str | None = None,
    context: str | None = None,
) -> str:
    skills_payload = [
        {"id": skill.id, "name": skill.name, "description": skill.description, "instructions": skill.instructions[:1000]}
        for skill in active_skills
    ]
    required_ids = [skill.id for skill in required_skills]
    parts = [
        f"使用者任務：{prompt}",
        f"必跑技能 IDs：{json.dumps(required_ids, ensure_ascii=False)}",
        f"所有可用技能：{json.dumps(skills_payload, ensure_ascii=False)}",
    ]
    if stock:
        parts.append(f"股票：{stock}")
    if context:
        parts.append(f"先前對話摘要：\n{context[-3000:]}")
    return "\n\n".join(parts)


def _specialist_prompt(prompt: str, skill: Skill, stock: str | None = None, context: str | None = None) -> str:
    parts = [
        f"使用者任務：{prompt}",
        f"技能名稱：{skill.name}",
    ]
    if stock:
        parts.append(f"股票：{stock}")
    if context:
        parts.append(f"先前對話摘要：\n{context[-3000:]}")
    return "\n\n".join(parts)


def _manager_prompt(
    prompt: str,
    results: list[SpecialistResult],
    stock: str | None = None,
    context: str | None = None,
) -> str:
    specialist_blocks = "\n\n".join(
        f"## Specialist: {result.skill_name}\n{result.output}" for result in results
    )
    parts = [
        f"使用者任務：{prompt}",
    ]
    if stock:
        parts.append(f"股票：{stock}")
    if context:
        parts.append(f"先前對話摘要：\n{context[-3000:]}")
    parts.append(f"Specialist outputs:\n\n{specialist_blocks}")
    return "\n\n".join(parts)


def _research_prompt(prompt: str, stock: str | None = None, context: str | None = None) -> str:
    parts = [f"使用者任務：{prompt}"]
    if stock:
        parts.append(f"股票：{stock}")
    if context:
        parts.append(f"先前對話摘要：\n{context[-3000:]}")
    return "\n\n".join(parts)


def _skill_draft_prompt(prompt: str, context: str | None = None) -> str:
    parts = [f"使用者想建立的技能需求：{prompt}"]
    if context:
        parts.append(f"相關對話摘要：\n{context[-3000:]}")
    return "\n\n".join(parts)


async def _normalize_agent_event(event: Any, skill: Skill) -> AsyncIterator[dict[str, Any]]:
    async for normalized in _normalize_common_event(event):
        normalized["payload"]["agent"] = skill.name
        normalized["payload"]["skill_id"] = skill.id
        yield normalized


async def _normalize_manager_event(event: Any, agent_name: str = "ManagerAgent") -> AsyncIterator[dict[str, Any]]:
    async for normalized in _normalize_common_event(event):
        normalized["payload"]["agent"] = agent_name
        yield normalized


async def _normalize_common_event(event: Any) -> AsyncIterator[dict[str, Any]]:
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
                "payload": {"event_type": event_type, "data": _to_jsonable(data)},
            }
        return

    if event.type == "run_item_stream_event":
        if "reasoning" in event.name:
            yield {
                "type": "reasoning_event",
                "payload": {"event_type": event.name, "item": _to_jsonable(event.item)},
            }
            return

        if event.name == "tool_called" and isinstance(event.item, ToolCallItem):
            yield {
                "type": "tool_called",
                "payload": {"item": _to_jsonable(event.item.raw_item)},
            }
            return

        if event.name == "tool_output" and isinstance(event.item, ToolCallOutputItem):
            yield {
                "type": "tool_output",
                "payload": {"output": _to_jsonable(event.item.output)},
            }
            return


def _summarize_text(value: Any) -> str:
    text = str(value).strip().replace("\n", " ")
    return text[:240] + ("..." if len(text) > 240 else "")


def _extract_json_object(value: str) -> dict[str, Any]:
    text = value.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:]
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return {}
        try:
            payload = json.loads(text[start : end + 1])
        except json.JSONDecodeError:
            return {}
    return payload if isinstance(payload, dict) else {}


def _to_jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if isinstance(value, dict):
        return {str(key): _to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

from __future__ import annotations

import json
import re
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass, is_dataclass
from typing import Any

from agents import Runner
from agents.items import ToolCallItem, ToolCallOutputItem
from agents.mcp import MCPServer
from openai.types.responses import (
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseReasoningTextDeltaEvent,
    ResponseTextDeltaEvent,
)

from .agents import financial_analysis_agent, financial_visualization_agent
from .prompt_store import render_prompt
from .schemas import SpecialistResult, normalize_stock_input


@dataclass(frozen=True)
class AnalysisPlan:
    stock: str
    question: str
    sections: list[str]
    context: str = ""


SECTION_PATTERNS: list[tuple[str, str]] = [
    ("overview", r"公司|概要|基本|產品|客戶|business|company|overview"),
    ("quote", r"股價|即時|quote|price|current"),
    ("technical", r"技術|均線|移動平均|四大|買賣點|歷史|OHLC|technical|moving average"),
    ("valuation", r"估值|合理價|本益比|PE|PB|fair value|valuation"),
    ("growth", r"成長|營收|EPS|動能|growth|momentum"),
    ("financial_health", r"財務體質|毛利|營益|淨利|ROE|margin|health"),
    ("cashflow", r"現金流|負債|庫存|cash ?flow|debt|inventory"),
    ("peers", r"同業|比較|peer|competitor"),
    ("entry_strategy", r"分批|買進|進場|entry|strategy"),
    ("visualization", r"圖|圖表|視覺化|畫|chart|visual|visualize|image|graph|plot"),
]

DEFAULT_SECTIONS = ["overview", "quote", "valuation", "growth"]
FULL_ANALYSIS_PATTERN = re.compile(r"完整|全部|全面|full|complete|report", re.IGNORECASE)
ALL_SECTIONS = [name for name, _pattern in SECTION_PATTERNS if name != "visualization"]


async def run_financial_analysis(
    stock: str,
    mcp_servers: list[MCPServer],
    question: str | None = None,
    context: str | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run the simplified financial workflow and yield NDJSON-compatible events."""

    plan = build_analysis_plan(stock=stock, question=question, context=context)

    yield {
        "type": "agent_started",
        "payload": {
            "agent": "FinancialAnalysisOrchestrator",
            "detail": f"Planning analysis for {plan.stock}",
        },
    }
    yield {
        "type": "reasoning_event",
        "payload": {
            "event_type": "analysis_plan",
            "data": {
                "stock": plan.stock,
                "question": plan.question,
                "sections": plan.sections,
                "has_context": bool(plan.context),
            },
        },
    }

    collected_data: dict[str, Any] = {}
    async for event in collect_financial_data(plan, mcp_servers, collected_data):
        yield event

    yield {
        "type": "agent_started",
        "payload": {
            "agent": "FinancialAnalysisAgent",
            "detail": "Interpreting collected data",
        },
    }

    agent = financial_analysis_agent(mcp_servers)
    prompt = render_prompt(
        "financial_analysis.input",
        stock=plan.stock,
        question=plan.question,
        sections=", ".join(plan.sections),
        collected_data=json.dumps(collected_data, ensure_ascii=False, indent=2),
    )

    result = Runner.run_streamed(agent, input=prompt, max_turns=12)
    async for event in result.stream_events():
        async for normalized in normalize_agent_event(event):
            yield normalized

    yield {
        "type": "agent_completed",
        "payload": {"agent": "FinancialAnalysisAgent", "summary": "Analysis response completed"},
    }

    if "visualization" in plan.sections:
        async for event in run_financial_visualization(plan, collected_data):
            yield event


def build_analysis_plan(
    stock: str,
    question: str | None = None,
    context: str | None = None,
) -> AnalysisPlan:
    normalized_stock = normalize_stock_input(stock)
    effective_question = (question or stock).strip() or normalized_stock
    sections = infer_sections(effective_question)
    effective_context = (context or "").strip()
    if not normalized_stock.isdigit() and effective_context:
        context_stock = normalize_stock_input(effective_context)
        if context_stock.isdigit():
            normalized_stock = context_stock
    return AnalysisPlan(
        stock=normalized_stock,
        question=effective_question,
        sections=sections,
        context=effective_context,
    )


def infer_sections(question: str) -> list[str]:
    if FULL_ANALYSIS_PATTERN.search(question):
        return ALL_SECTIONS.copy()

    sections = [
        name
        for name, pattern in SECTION_PATTERNS
        if re.search(pattern, question, re.IGNORECASE)
    ]
    return sections or DEFAULT_SECTIONS.copy()


async def collect_financial_data(
    plan: AnalysisPlan,
    mcp_servers: list[MCPServer],
    collected_data: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    if not plan.stock.isdigit():
        collected_data["note"] = "No numeric Taiwan stock code was detected; MCP stock lookups may be skipped."
        return

    tool_calls = ["get_stock_info", "get_realtime_quote"]
    if "technical" in plan.sections or "visualization" in plan.sections:
        tool_calls.extend(["get_historical_data", "calculate_moving_average", "analyze_best_four_point"])
    elif any(section in plan.sections for section in ("valuation", "growth")):
        tool_calls.append("get_historical_data")

    for tool_name in dict.fromkeys(tool_calls):
        args = mcp_args_for_tool(tool_name, plan.stock)
        yield {
            "type": "tool_called",
            "payload": {"item": {"name": tool_name, "arguments": args, "source": "backend_data_collector"}},
        }
        try:
            result = await call_mcp_tool(mcp_servers, tool_name, args)
            collected_data[tool_name] = result
            yield {"type": "tool_output", "payload": {"output": {tool_name: result}}}
        except Exception as exc:
            error = {"success": False, "error": str(exc)}
            collected_data[tool_name] = error
            yield {
                "type": "tool_output",
                "payload": {"output": {tool_name: error}},
            }


async def run_financial_visualization(
    plan: AnalysisPlan,
    collected_data: dict[str, Any],
) -> AsyncIterator[dict[str, Any]]:
    yield {
        "type": "agent_started",
        "payload": {
            "agent": "FinancialVisualizationAgent",
            "detail": "Generating chart image from stock data",
        },
    }

    visualization_data = compact_visualization_data(collected_data)
    prompt = render_prompt(
        "financial_visualization.input",
        stock=plan.stock,
        question=plan.question,
        sections=", ".join(plan.sections),
        context=plan.context[-2500:],
        visualization_data=json.dumps(visualization_data, ensure_ascii=False, indent=2),
    )

    try:
        result = await Runner.run(financial_visualization_agent(), prompt, max_turns=6)
        image = extract_image_payload(result)
        description = stringify_output(result.final_output)[:500]
        if image:
            yield {
                "type": "image_generated",
                "payload": {
                    "agent": "FinancialVisualizationAgent",
                    "title": f"{plan.stock} financial visualization",
                    "description": description,
                    "image": image,
                },
            }
            yield {
                "type": "agent_completed",
                "payload": {"agent": "FinancialVisualizationAgent", "summary": "Visualization image completed"},
            }
            return

        yield {
            "type": "error",
            "payload": {
                "agent": "FinancialVisualizationAgent",
                "message": "ImageGenerationTool completed without an extractable image payload.",
            },
        }
    except Exception as exc:
        yield {
            "type": "error",
            "payload": {"agent": "FinancialVisualizationAgent", "message": str(exc)},
        }


def compact_visualization_data(collected_data: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for key, value in collected_data.items():
        compact[key] = limit_nested_lists(to_jsonable(value), max_items=12)
    return compact


def limit_nested_lists(value: Any, max_items: int) -> Any:
    if isinstance(value, list):
        if len(value) <= max_items:
            return [limit_nested_lists(item, max_items) for item in value]
        return {
            "first": [limit_nested_lists(item, max_items) for item in value[: max_items // 2]],
            "last": [limit_nested_lists(item, max_items) for item in value[-max_items // 2 :]],
            "omitted_items": len(value) - max_items,
        }
    if isinstance(value, dict):
        return {key: limit_nested_lists(item, max_items) for key, item in value.items()}
    return value


def mcp_args_for_tool(tool_name: str, stock: str) -> dict[str, Any]:
    if tool_name == "calculate_moving_average":
        return {"stock_id": stock, "days": 20}
    return {"stock_id": stock}


async def call_mcp_tool(
    mcp_servers: list[MCPServer],
    tool_name: str,
    arguments: dict[str, Any],
) -> Any:
    server = await find_server_for_tool(mcp_servers, tool_name)
    if server is None:
        raise RuntimeError(f"MCP tool {tool_name} is not available.")
    result = await server.call_tool(tool_name, arguments)
    return to_jsonable(result)


async def find_server_for_tool(mcp_servers: list[MCPServer], tool_name: str) -> MCPServer | None:
    for server in mcp_servers:
        cached_tools = server.cached_tools
        tools = cached_tools if cached_tools is not None else await server.list_tools()
        if any(tool.name == tool_name for tool in tools):
            return server
    return None


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


def coerce_specialist_result(value: Any) -> SpecialistResult:
    """Backward-compatible helper for existing tests and callers."""
    if isinstance(value, SpecialistResult):
        return value
    if isinstance(value, dict):
        return SpecialistResult.model_validate(value)
    return SpecialistResult(summary=stringify_output(value), confidence="medium")


def serialize_results(results: dict[str, SpecialistResult]) -> dict[str, Any]:
    """Backward-compatible helper for existing tests and callers."""
    return {key: value.model_dump(mode="json") for key, value in results.items()}


def stringify_output(value: Any) -> str:
    if isinstance(value, str):
        return value
    if hasattr(value, "model_dump"):
        return json.dumps(value.model_dump(mode="json"), ensure_ascii=False, indent=2)
    return json.dumps(to_jsonable(value), ensure_ascii=False, indent=2)


def extract_image_payload(result: Any) -> dict[str, Any] | None:
    data = {
        "final_output": to_jsonable(getattr(result, "final_output", None)),
        "new_items": to_jsonable(getattr(result, "new_items", [])),
        "raw_responses": to_jsonable(getattr(result, "raw_responses", [])),
    }
    image_result = find_image_generation_result(data)
    if not image_result:
        return None
    image_url = f"data:image/png;base64,{image_result}"
    return {
        "b64_json": image_result,
        "image_url": image_url,
        "mime_type": "image/png",
    }


def find_image_generation_result(value: Any) -> str | None:
    if isinstance(value, dict):
        if value.get("type") == "image_generation_call" and isinstance(value.get("result"), str):
            return value["result"]
        for item in value.values():
            found = find_image_generation_result(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_image_generation_result(item)
            if found:
                return found
    return None


def to_jsonable(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json")
    if is_dataclass(value) and not isinstance(value, type):
        return to_jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)

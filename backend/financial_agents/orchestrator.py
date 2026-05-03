import asyncio
import json
import os
from collections.abc import AsyncIterator, Callable
from typing import Any

from agents import Runner
from agents.items import ToolCallItem, ToolCallOutputItem
from agents.mcp import MCPServer
from openai.types.responses import (
    ResponseReasoningSummaryTextDeltaEvent,
    ResponseReasoningTextDeltaEvent,
    ResponseTextDeltaEvent,
)

from .agents import (
    cashflow_structure_agent,
    company_overview_agent,
    entry_strategy_agent,
    financial_health_agent,
    growth_momentum_agent,
    peer_comparison_agent,
    report_synthesis_agent,
    six_way_pe_valuation_agent,
    valuation_state_agent,
    visual_summary_agent,
)
from .schemas import DISCLAIMER, SpecialistResult, normalize_stock_input

StreamPayload = dict[str, Any]
EventSink = Callable[[str, StreamPayload], None]


async def run_financial_analysis(stock: str, mcp_servers: list[MCPServer]) -> AsyncIterator[dict[str, Any]]:
    normalized_stock = normalize_stock_input(stock)
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

    def emit(event_type: str, payload: StreamPayload) -> None:
        queue.put_nowait({"type": event_type, "payload": payload})

    emit("agent_started", {"agent": "FinancialReportOrchestrator", "detail": f"開始分析 {normalized_stock}"})

    research_specs = [
        ("company_overview", company_overview_agent(mcp_servers), overview_prompt(normalized_stock)),
        ("financial_health", financial_health_agent(), financial_health_prompt(normalized_stock)),
        ("growth_momentum", growth_momentum_agent(), growth_prompt(normalized_stock)),
        ("valuation_state", valuation_state_agent(mcp_servers), valuation_prompt(normalized_stock)),
        ("cashflow_structure", cashflow_structure_agent(), cashflow_prompt(normalized_stock)),
        ("peer_comparison", peer_comparison_agent(), peer_prompt(normalized_stock)),
        ("six_way_pe", six_way_pe_valuation_agent(), six_way_prompt(normalized_stock)),
    ]

    tasks = [
        asyncio.create_task(run_specialist(key, agent, prompt, emit))
        for key, agent, prompt in research_specs
    ]

    pending = set(tasks)
    results: dict[str, SpecialistResult] = {}
    while pending:
        done, pending = await asyncio.wait(pending, timeout=0.1, return_when=asyncio.FIRST_COMPLETED)
        while not queue.empty():
            yield await queue.get()
        for task in done:
            key, result = task.result()
            results[key] = result

    while not queue.empty():
        yield await queue.get()

    entry_result = await run_specialist(
        "entry_strategy",
        entry_strategy_agent(),
        entry_strategy_prompt(normalized_stock, results),
        emit,
    )
    results[entry_result[0]] = entry_result[1]
    while not queue.empty():
        yield await queue.get()

    synthesis_input = synthesis_prompt(normalized_stock, results)
    emit("agent_started", {"agent": "FinancialReportOrchestrator", "detail": "整合專家輸出並產生最終報告"})
    while not queue.empty():
        yield await queue.get()

    final_agent = report_synthesis_agent()
    final_result = Runner.run_streamed(final_agent, input=synthesis_input, max_turns=8)
    async for event in final_result.stream_events():
        async for normalized in normalize_agent_event(event):
            yield normalized

    emit("agent_completed", {"agent": "FinancialReportOrchestrator", "summary": "最終財務分析報告已完成"})
    while not queue.empty():
        yield await queue.get()

    if os.getenv("ENABLE_FINANCIAL_IMAGE", "true").lower() == "true":
        async for image_event in run_visual_summary(normalized_stock, results):
            yield image_event


async def run_specialist(
    key: str,
    agent,
    prompt: str,
    emit: EventSink,
) -> tuple[str, SpecialistResult]:
    emit("agent_started", {"agent": agent.name, "detail": key})
    try:
        result = await Runner.run(agent, prompt, max_turns=8)
        output = coerce_specialist_result(result.final_output)
        emit("agent_completed", {"agent": agent.name, "summary": output.summary or "完成"})
        for source in output.sources:
            if source.url:
                emit("source_found", {"agent": agent.name, "title": source.title, "url": source.url, "note": source.note})
        return key, output
    except Exception as exc:
        fallback = SpecialistResult(
            summary=f"{agent.name} 分析失敗：{exc}",
            assumptions=["此段落需使用者稍後重試或改以人工來源補齊。"],
            confidence="low",
        )
        emit("error", {"agent": agent.name, "message": str(exc)})
        return key, fallback


async def run_visual_summary(stock: str, results: dict[str, SpecialistResult]) -> AsyncIterator[dict[str, Any]]:
    yield {
        "type": "agent_started",
        "payload": {"agent": "VisualSummaryAgent", "detail": "產生財務視覺摘要"},
    }
    try:
        result = await Runner.run(
            visual_summary_agent(),
            visual_prompt(stock, results),
            max_turns=4,
        )
        summary = stringify_output(result.final_output)
        yield {
            "type": "image_generated",
            "payload": {
                "agent": "VisualSummaryAgent",
                "title": f"{stock} 財務分析視覺摘要",
                "description": summary,
                "image": extract_image_payload(result),
            },
        }
        yield {
            "type": "agent_completed",
            "payload": {"agent": "VisualSummaryAgent", "summary": "視覺摘要已完成"},
        }
    except Exception as exc:
        yield {
            "type": "error",
            "payload": {"agent": "VisualSummaryAgent", "message": str(exc)},
        }


def coerce_specialist_result(value: Any) -> SpecialistResult:
    if isinstance(value, SpecialistResult):
        return value
    if isinstance(value, dict):
        return SpecialistResult.model_validate(value)
    return SpecialistResult(summary=stringify_output(value), confidence="medium")


def stringify_output(value: Any) -> str:
    if isinstance(value, str):
        return value
    if hasattr(value, "model_dump"):
        return json.dumps(value.model_dump(mode="json"), ensure_ascii=False, indent=2)
    return json.dumps(to_jsonable(value), ensure_ascii=False, indent=2)


def extract_image_payload(result: Any) -> dict[str, Any] | None:
    data = to_jsonable(result)
    text = json.dumps(data, ensure_ascii=False)
    if "image" not in text.lower():
        return None
    return {"raw_result_excerpt": text[:2000]}


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


def overview_prompt(stock: str) -> str:
    return f"分析股票 {stock} 的公司基本概要。請只輸出你的負責段落資料。"


def financial_health_prompt(stock: str) -> str:
    return f"分析股票 {stock} 的財務體質達標狀態。請查找最新可得財報資料。"


def growth_prompt(stock: str) -> str:
    return f"分析股票 {stock} 的成長動能，包含近6個月月營收 YoY/MoM 與 EPS 趨勢。"


def valuation_prompt(stock: str) -> str:
    return f"分析股票 {stock} 的估值狀態，包含 PE、PB、河流圖區間與目前股價高低。"


def cashflow_prompt(stock: str) -> str:
    return f"分析股票 {stock} 的現金流與財務結構。"


def peer_prompt(stock: str) -> str:
    return f"替股票 {stock} 找至少兩家同業，並做財務與估值比較。"


def six_way_prompt(stock: str) -> str:
    return f"依六種本益比估值法估算股票 {stock} 的合理價，缺資料請合理假設並註明。"


def entry_strategy_prompt(stock: str, results: dict[str, SpecialistResult]) -> str:
    return (
        f"股票 {stock} 的專家分析如下。請只產出合理買進價格與分批策略。\n\n"
        f"{json.dumps(serialize_results(results), ensure_ascii=False, indent=2)}"
    )


def synthesis_prompt(stock: str, results: dict[str, SpecialistResult]) -> str:
    return (
        f"請整合以下專家輸出，為股票 {stock} 產生完整繁體中文財務分析報告。\n"
        "格式必須包含：公司基本概要、財務體質表、成長動能、估值分析、現金流與財務結構、"
        "同業比較、合理買進價格與分批策略、六種本益比估值表、重點總結。\n"
        f"最後逐字加入提醒：「{DISCLAIMER}」\n\n"
        f"{json.dumps(serialize_results(results), ensure_ascii=False, indent=2)}"
    )


def visual_prompt(stock: str, results: dict[str, SpecialistResult]) -> str:
    compact = {
        key: {"summary": value.summary, "confidence": value.confidence, "assumptions": value.assumptions[:3]}
        for key, value in results.items()
    }
    return (
        f"請為股票 {stock} 產生一張繁體中文財務分析視覺摘要圖。"
        "包含合理價區間、估值判斷、財務體質、成長動能與主要風險。"
        f"資料摘要：{json.dumps(compact, ensure_ascii=False)}"
    )


def serialize_results(results: dict[str, SpecialistResult]) -> dict[str, Any]:
    return {key: value.model_dump(mode="json") for key, value in results.items()}

"""
Financial Analysis Orchestrator.

Thin orchestration layer: parses the user request, hands it to the
FinancialAnalysisAgent (which owns all tool-calling decisions via the
OpenAI Agents SDK), and streams events to the frontend.

The agent has MCP twstock tools and WebSearch available.  The SDK's
native tool-calling loop lets the model decide which tools to call,
in what order, and how many times.

Visualization is handled separately: when the user asks for a chart,
the orchestrator runs the FinancialVisualizationAgent with the chat
context as input data.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from collections.abc import AsyncIterator
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
from .schemas import SpecialistResult, normalize_stock_input
from agent_tracing import run_config, trace_url
from utils import to_jsonable

# ---------------------------------------------------------------------------
# Visualization detection
# ---------------------------------------------------------------------------

_VISUALIZATION_PATTERN = re.compile(
    r"圖|圖表|視覺化|畫|chart|visual|visualize|image|graph|plot",
    re.IGNORECASE,
)


def _is_visualization_request(question: str) -> bool:
    return bool(_VISUALIZATION_PATTERN.search(question))


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

async def run_financial_analysis(
    stock: str,
    mcp_servers: list[MCPServer],
    question: str | None = None,
    context: str | None = None,
    trace_id: str | None = None,
    trace_metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run the financial analysis and yield NDJSON-compatible events."""

    normalized_stock = normalize_stock_input(stock)
    effective_question = (question or stock).strip() or normalized_stock

    # --- Analysis flow: let the agent handle everything ---
    yield {
        "type": "agent_started",
        "payload": {
            "agent": "FinancialAnalysisAgent",
            "detail": f"Analyzing {normalized_stock}",
        },
    }

    agent = financial_analysis_agent(mcp_servers)
    prompt = f"股票：{normalized_stock}\n問題：{effective_question}"
    if context:
        prompt += f"\n\n先前對話摘要：\n{context[-3000:]}"

    metadata = {
        **(trace_metadata or {}),
        "agent": "FinancialAnalysisAgent",
        "stock": normalized_stock,
        "workflow": "Financial analysis",
    }
    result = Runner.run_streamed(
        agent,
        input=prompt,
        max_turns=20,
        run_config=run_config("Financial analysis", trace_id=trace_id, group_id=normalized_stock, metadata=metadata),
    )
    async for event in result.stream_events():
        async for normalized in _normalize_agent_event(event):
            yield normalized

    yield {
        "type": "agent_completed",
        "payload": {
            "agent": "FinancialAnalysisAgent",
            "summary": "Analysis completed",
        },
    }

    # If image generation is enabled and this was a full analysis,
    # the agent may have already answered everything.  Visualization
    # is only triggered when the user explicitly asks for a chart.


# ---------------------------------------------------------------------------
# Visualization flow
# ---------------------------------------------------------------------------

async def _run_visualization(
    stock: str,
    question: str,
    context: str | None,
    trace_id: str | None = None,
    trace_metadata: dict[str, Any] | None = None,
) -> AsyncIterator[dict[str, Any]]:
    """Run the visualization agent with chat context as data source."""

    if os.getenv("ENABLE_FINANCIAL_IMAGE", "true").lower() != "true":
        yield {
            "type": "error",
            "payload": {
                "agent": "FinancialVisualizationAgent",
                "message": "Image generation is disabled (ENABLE_FINANCIAL_IMAGE=false).",
            },
        }
        return

    yield {
        "type": "agent_started",
        "payload": {
            "agent": "FinancialVisualizationAgent",
            "detail": "Generating visualization",
        },
    }

    # Build prompt from chat context — the visualization agent uses
    # data already shown in the conversation, not fresh tool calls.
    chart_data = _extract_chart_data(context) if context else "No prior data available."
    prompt = (
        f"股票：{stock}\n"
        f"使用者要求：{question}\n\n"
        f"以下是對話中已有的數據，用這些數據生成圖表：\n{chart_data}"
    )
    image_id = f"image-{uuid.uuid4()}"
    yield {
        "type": "image_generation_started",
        "payload": {
            "id": image_id,
            "agent": "FinancialVisualizationAgent",
            "title": f"{stock} financial visualization",
            "description": "Generating financial visualization.",
            "trace_id": trace_id,
            "trace_url": trace_url(trace_id) if trace_id else None,
            "model": os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2"),
            "size": os.getenv("OPENAI_IMAGE_SIZE", "1024x1024"),
            "quality": os.getenv("OPENAI_IMAGE_QUALITY", "medium"),
        },
    }

    try:
        metadata = {
            **(trace_metadata or {}),
            "agent": "FinancialVisualizationAgent",
            "stock": stock,
            "workflow": "Financial visualization",
        }
        vis_result = await Runner.run(
            financial_visualization_agent(),
            prompt,
            max_turns=6,
            run_config=run_config(
                "Financial visualization",
                trace_id=trace_id,
                group_id=stock,
                metadata=metadata,
            ),
        )
        images = _extract_image_payloads(vis_result)
        description = _stringify_output(vis_result.final_output)[:500]

        if images:
            for index, image in enumerate(images):
                yield {
                    "type": "image_generated",
                    "payload": {
                        "id": image_id if index == 0 else f"image-{uuid.uuid4()}",
                        "agent": "FinancialVisualizationAgent",
                        "title": f"{stock} financial visualization" if len(images) == 1 else f"{stock} financial visualization {index + 1}",
                        "description": description,
                        "image": image,
                        "trace_id": trace_id,
                        "trace_url": trace_url(trace_id) if trace_id else None,
                        "model": os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2"),
                        "size": os.getenv("OPENAI_IMAGE_SIZE", "1024x1024"),
                        "quality": os.getenv("OPENAI_IMAGE_QUALITY", "medium"),
                    },
                }
            yield {
                "type": "agent_completed",
                "payload": {
                    "agent": "FinancialVisualizationAgent",
                    "summary": "Visualization completed",
                },
            }
        else:
            # Log what we got for debugging
            debug_info = {
                "has_final_output": getattr(vis_result, "final_output", None) is not None,
                "new_items_count": len(getattr(vis_result, "new_items", []) or []),
                "new_items_types": [
                    type(item).__name__ for item in (getattr(vis_result, "new_items", []) or [])
                ],
                "raw_responses_count": len(getattr(vis_result, "raw_responses", []) or []),
            }
            yield {
                "type": "error",
                "payload": {
                    "agent": "FinancialVisualizationAgent",
                    "message": f"Image generation completed but no image was extracted. Debug: {json.dumps(debug_info)}",
                },
            }
    except Exception as exc:
        yield {
            "type": "error",
            "payload": {
                "agent": "FinancialVisualizationAgent",
                "message": str(exc),
            },
        }


def _extract_chart_data(context: str) -> str:
    """Pull numeric-heavy lines from chat history for the visualization agent."""
    lines = [line.strip() for line in context.splitlines() if line.strip()]
    numeric_lines = [line for line in lines if re.search(r"\d", line)]
    source_lines = numeric_lines or lines
    summary = "\n".join(source_lines[-24:])
    return summary[-3000:] if summary else "No numerical data found in chat history."


# ---------------------------------------------------------------------------
# Event normalization
# ---------------------------------------------------------------------------

async def _normalize_agent_event(event: Any) -> AsyncIterator[dict[str, Any]]:
    """Convert OpenAI Agents SDK stream events into our NDJSON contract."""
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


# ---------------------------------------------------------------------------
# Backward-compatible helpers (used by tests)
# ---------------------------------------------------------------------------

def coerce_specialist_result(value: Any) -> SpecialistResult:
    if isinstance(value, SpecialistResult):
        return value
    if isinstance(value, dict):
        return SpecialistResult.model_validate(value)
    return SpecialistResult(summary=_stringify_output(value), confidence="medium")


def serialize_results(results: dict[str, SpecialistResult]) -> dict[str, Any]:
    return {key: value.model_dump(mode="json") for key, value in results.items()}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stringify_output(value: Any) -> str:
    if isinstance(value, str):
        return value
    if hasattr(value, "model_dump"):
        return json.dumps(value.model_dump(mode="json"), ensure_ascii=False, indent=2)
    return json.dumps(to_jsonable(value), ensure_ascii=False, indent=2)


def _extract_image_payload(result: Any) -> dict[str, Any] | None:
    images = _extract_image_payloads(result)
    return images[0] if images else None


def _extract_image_payloads(result: Any) -> list[dict[str, Any]]:
    """Extract base64 image data from an Agents SDK RunResult.

    The ImageGenerationTool produces an ``image_generation_call`` output item
    in the Responses API.  It can appear in:
    - ``result.raw_responses[*].output[*]``  (raw API response objects)
    - ``result.new_items[*].raw_item``       (SDK RunItem wrappers)
    - ``result.final_output``                (if the agent returns it directly)

    We recursively search all of these, converting Pydantic models and
    dataclasses to dicts first so the recursive dict/list walker can find
    the ``{"type": "image_generation_call", "result": "<base64>"}`` node.
    """
    # Collect all searchable surfaces
    surfaces: list[Any] = []

    # raw_responses: list of ModelResponse objects
    for resp in getattr(result, "raw_responses", []) or []:
        # Each ModelResponse has an .output list
        output = getattr(resp, "output", None)
        if output:
            surfaces.append(output)
        # Also try the full response object
        surfaces.append(resp)

    # new_items: list of RunItem wrappers (ToolCallItem, ToolCallOutputItem, etc.)
    for item in getattr(result, "new_items", []) or []:
        raw = getattr(item, "raw_item", None)
        if raw is not None:
            surfaces.append(raw)
        # ToolCallOutputItem has .output
        output = getattr(item, "output", None)
        if output is not None:
            surfaces.append(output)

    # final_output
    final = getattr(result, "final_output", None)
    if final is not None:
        surfaces.append(final)

    # Convert everything to JSON-safe dicts and search
    payloads: list[dict[str, Any]] = []
    seen: set[str] = set()
    for surface in surfaces:
        jsonable = to_jsonable(surface)
        for b64 in _find_image_generation_results(jsonable):
            if b64 in seen:
                continue
            seen.add(b64)
            payloads.append(
                {
                    "b64_json": b64,
                    "image_url": f"data:image/png;base64,{b64}",
                    "mime_type": "image/png",
                }
            )

    return payloads


def _find_image_generation_result(value: Any) -> str | None:
    results = _find_image_generation_results(value)
    return results[0] if results else None


def _find_image_generation_results(value: Any) -> list[str]:
    """Recursively search for a base64 image string in a JSON-safe structure.

    Looks for:
    - ``{"type": "image_generation_call", "result": "<base64>"}``
    - Any dict with a ``"b64_json"`` key containing a long base64 string
    """
    results: list[str] = []
    if isinstance(value, dict):
        # Direct match: Responses API image_generation_call
        if value.get("type") == "image_generation_call" and isinstance(value.get("result"), str):
            result_val = value["result"]
            if len(result_val) > 100:  # base64 images are large
                results.append(result_val)

        # Alternative: some SDK versions use b64_json
        if isinstance(value.get("b64_json"), str) and len(value["b64_json"]) > 100:
            results.append(value["b64_json"])

        # Recurse into all values
        for item in value.values():
            results.extend(_find_image_generation_results(item))

    if isinstance(value, list):
        for item in value:
            results.extend(_find_image_generation_results(item))

    # Handle long strings that look like base64 (fallback for edge cases)
    if isinstance(value, str) and len(value) > 1000:
        # Check if it looks like base64 (only alphanumeric + /+=)
        import re
        if re.fullmatch(r"[A-Za-z0-9+/=\s]+", value[:200]):
            results.append(value)

    return results



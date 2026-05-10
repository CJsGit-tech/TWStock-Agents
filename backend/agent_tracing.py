from __future__ import annotations

import asyncio
import os
from typing import Any

from agents import RunConfig, trace
from agents.tracing import gen_trace_id, get_trace_provider, set_tracing_export_api_key


TRACE_URL_BASE = "https://platform.openai.com/traces"


def configure_tracing_api_key(api_key: str) -> None:
    set_tracing_export_api_key(api_key)


def new_trace_id() -> str:
    return gen_trace_id()


def trace_url(trace_id: str) -> str:
    return f"{TRACE_URL_BASE}/{trace_id}"


async def flush_trace_exports() -> None:
    """Force-flush the trace exporter so buffered spans/traces are sent immediately."""
    try:
        provider = get_trace_provider()
        processor = getattr(provider, "_multi_processor", None)
        if processor and hasattr(processor, "force_flush"):
            processor.force_flush()
        await asyncio.sleep(0.5)
    except Exception:
        pass


def run_config(
    workflow_name: str,
    *,
    trace_id: str | None = None,
    group_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> RunConfig:
    return RunConfig(
        workflow_name=workflow_name,
        trace_id=trace_id,
        group_id=group_id,
        trace_metadata=metadata,
    )

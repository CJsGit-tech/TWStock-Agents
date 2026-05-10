from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from typing import Any

from agents import RunConfig, set_tracing_disabled, trace
from agents.tracing import gen_trace_id, get_trace_provider, set_tracing_export_api_key


FALSE_ENV_VALUES = {"0", "false", "off", "no"}
TRUE_ENV_VALUES = {"1", "true", "on", "yes"}
TRACE_URL_BASE = "https://platform.openai.com/traces"
DEFAULT_TRACING_ENABLED = "true"


def tracing_disabled() -> bool:
    return os.getenv("OPENAI_AGENTS_DISABLE_TRACING", "").lower() in TRUE_ENV_VALUES or os.getenv(
        "OPENAI_AGENTS_TRACING_ENABLED",
        "true",
    ).lower() in FALSE_ENV_VALUES


def configure_tracing() -> None:
    os.environ.setdefault("OPENAI_AGENTS_TRACING_ENABLED", DEFAULT_TRACING_ENABLED)
    set_tracing_disabled(tracing_disabled())


def configure_tracing_api_key(api_key: str) -> None:
    set_tracing_export_api_key(api_key)


def trace_include_sensitive_data() -> bool:
    return os.getenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "true").lower() not in FALSE_ENV_VALUES


def new_trace_id() -> str:
    return gen_trace_id()


def trace_url(trace_id: str) -> str:
    return f"{TRACE_URL_BASE}/{trace_id}"


async def flush_trace_exports() -> None:
    """Force-flush the trace exporter so buffered spans/traces are sent immediately.

    Call this in the `finally` block of streaming generators to ensure traces
    are exported even if the client disconnects or the generator is cancelled.
    """
    try:
        provider = get_trace_provider()
        processor = getattr(provider, "_multi_processor", None)
        if processor and hasattr(processor, "force_flush"):
            processor.force_flush()
        # Give the async exporter a moment to send buffered data.
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
        tracing_disabled=tracing_disabled(),
        trace_include_sensitive_data=trace_include_sensitive_data(),
        workflow_name=workflow_name,
        trace_id=trace_id,
        group_id=group_id,
        trace_metadata=metadata,
    )


def workflow_trace(
    workflow_name: str,
    *,
    trace_id: str | None = None,
    group_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> Iterator[Any]:
    return trace(
        workflow_name,
        trace_id=trace_id,
        group_id=group_id,
        metadata=metadata,
        disabled=tracing_disabled(),
    )

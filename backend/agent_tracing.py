from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

from agents import RunConfig, set_tracing_disabled, trace
from agents.tracing import gen_trace_id, set_tracing_export_api_key


FALSE_ENV_VALUES = {"0", "false", "off", "no"}
TRUE_ENV_VALUES = {"1", "true", "on", "yes"}
TRACE_URL_BASE = "https://platform.openai.com/traces"


def tracing_disabled() -> bool:
    return os.getenv("OPENAI_AGENTS_DISABLE_TRACING", "").lower() in TRUE_ENV_VALUES or os.getenv(
        "OPENAI_AGENTS_TRACING_ENABLED",
        "true",
    ).lower() in FALSE_ENV_VALUES


def configure_tracing() -> None:
    set_tracing_disabled(tracing_disabled())


def configure_tracing_api_key(api_key: str) -> None:
    set_tracing_export_api_key(api_key)


def trace_include_sensitive_data() -> bool:
    return os.getenv("OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA", "true").lower() not in FALSE_ENV_VALUES


def new_trace_id() -> str:
    return gen_trace_id()


def trace_url(trace_id: str) -> str:
    return f"{TRACE_URL_BASE}/{trace_id}"


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

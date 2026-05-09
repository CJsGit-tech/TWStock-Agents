# OpenAI Agents SDK + MCP Notes

## Avoid Async Object Pickle Errors

### Symptom

The frontend may show a streamed backend error like:

```text
cannot pickle '_asyncio.Future' object
```

### Confirmed Cause In This App

The confirmed failure path was this app's event serializer, not the OpenAI trace exporter:

```text
financial_agents/orchestrator.py:_to_jsonable
  -> dataclasses.asdict(event.item)
  -> copy.deepcopy(...)
  -> TypeError: cannot pickle '_asyncio.Future' object
```

`dataclasses.asdict(...)` recursively deep-copies nested values. Agents SDK stream event items can reference agent/runtime objects, and those can reference MCP streamable HTTP clients or sessions. MCP clients can hold asyncio primitives such as `Future`, which cannot be pickled or deep-copied.

### Fix Pattern

Do not call `dataclasses.asdict(...)` on Agents SDK event objects. Use shallow dataclass field traversal and recurse manually:

```python
from dataclasses import fields, is_dataclass


def to_jsonable(value):
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(mode="json")
        except Exception:
            return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {field.name: to_jsonable(getattr(value, field.name)) for field in fields(value)}
    if isinstance(value, dict):
        return {str(key): to_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)
```

### Tracing Guidance

The serializer fix above handles the observed crash. Tracing does not need to stay disabled for that issue.

Agents SDK tracing is enabled by default and appears in the OpenAI Platform Traces dashboard. Keep it enabled for normal development, and wrap multi-agent workflows in `trace(...)` so the dashboard groups the planner, specialists, manager, model calls, MCP calls, and built-in tool calls under one workflow.

```python
from agents import RunConfig, Runner, trace
from agents.tracing import gen_trace_id


trace_id = gen_trace_id()

with trace("Financial analysis", trace_id=trace_id, group_id=stock, metadata={"endpoint": "/api/financial-analysis/stream"}):
    result = Runner.run_streamed(
        agent,
        input=prompt,
        max_turns=20,
        run_config=run_config("Financial analysis", trace_id=trace_id),
    )
    async for event in result.stream_events():
        ...
```

Keep a runtime escape hatch for privacy, ZDR, or noisy local testing:

```python
from agents import RunConfig, set_tracing_disabled


tracing_disabled = os.getenv("OPENAI_AGENTS_DISABLE_TRACING") == "1"
set_tracing_disabled(tracing_disabled)


def run_config(workflow_name: str) -> RunConfig:
    return RunConfig(tracing_disabled=tracing_disabled, workflow_name=workflow_name)
```

Apply run config and trace grouping to every MCP-backed agent run:

- chat agents
- financial analysis agents
- visualization agents
- manager planners
- specialist agents
- manager synthesis agents
- fallback research agents
- skill prompt builder agents

### Current Implementation

This project now enables hosted tracing by default and disables it only when one of these is set:

- `OPENAI_AGENTS_DISABLE_TRACING=1`
- `OPENAI_AGENTS_TRACING_ENABLED=false`

Top-level trace grouping is in `backend/app.py` for:

- `MCP chat`
- `Financial analysis`
- `Agentic task`

Per-run `RunConfig` tracing options are in:

- `backend/agent_tracing.py`

If the OpenAI API key is pasted into the UI at runtime, update both the regular API key and the tracing exporter key. The Agents SDK exporter may have initialized before the runtime key existed:

```python
from agents.tracing import set_tracing_export_api_key


os.environ["OPENAI_API_KEY"] = api_key
set_tracing_export_api_key(api_key)
```

Do the same immediately after `load_dotenv()` if the app imports `agents` before loading environment variables.

Streamed workflows emit `trace_started` and `trace_completed` events with a `trace_id` and dashboard URL so a UI event log can link directly to the OpenAI trace.

Hosted tools such as `ImageGenerationTool` should be observed as tool calls inside the agent run in the parent workflow trace. Do not create a nested `trace(...)` or wrap the hosted tool call in a separate custom span unless debugging a tracing exporter issue; that can make dashboard grouping harder to reason about. The app should keep one request-level trace, run `FinancialVisualizationAgent` under that trace with `RunConfig(trace_id=...)`, and let the Agents SDK record the hosted image tool call under the agent run.

The backend stream wrappers also log exceptions with `logger.exception(...)` before returning an `error` event, so future issues should produce stack traces in:

```sh
docker compose logs chat-api
```

In development (`APP_ENV` unset or any value other than `production`/`prod`), streamed backend errors also include:

- `error_type`
- `traceback`

The frontend renders these details in the assistant message and Event History. This is intentionally development-only; set `APP_ENV=production` to avoid exposing stack traces in the UI.

### What Tracing Contains

The OpenAI Platform trace can include model calls, tool calls, tool outputs, handoffs/guardrails when present, and custom spans. This is separate from this app's Event History, which still receives lifecycle events, MCP readiness events, tool call events, tool output events, and backend exception details streamed by the app.

Use `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=false` if you want traces visible but want the SDK to omit sensitive payload data where supported.

### Rule Of Thumb

Do not deep-copy Agents SDK stream event objects. Treat them as live runtime objects, extract only the fields the UI needs, and stringify unknown runtime objects.

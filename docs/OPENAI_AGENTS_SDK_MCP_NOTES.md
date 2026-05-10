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

---

## Tracing Architecture

### Pattern: Higher Level Traces

Agents SDK tracing is enabled by default and appears in the [OpenAI Platform Traces dashboard](https://platform.openai.com/traces). We use the **"Higher level traces"** pattern from the [official docs](https://openai.github.io/openai-agents-python/tracing/#higher-level-traces):

1. **One `with trace(...)` per HTTP request** — opened at the endpoint boundary in `app.py`
2. **Every `Runner.run()` inside attaches to that trace** — via `run_config(trace_id=...)`
3. **The SDK auto-creates `agent_span` per Runner call** — nested under the parent trace

```python
# app.py — endpoint opens the trace context
from agents import trace
from agents.tracing import gen_trace_id

trace_id = gen_trace_id()

with trace("Financial analysis", trace_id=trace_id, group_id=stock, metadata=trace_metadata):
    async for event in run_financial_analysis(stock, mcp_servers, trace_id=trace_id, ...):
        yield encode_event(event["type"], event["payload"])
```

```python
# orchestrator.py — Runner attaches to the active trace via run_config
result = Runner.run_streamed(
    agent,
    input=prompt,
    max_turns=20,
    run_config=run_config("Financial analysis", trace_id=trace_id, group_id=stock, metadata=metadata),
)
async for event in result.stream_events():
    ...
```

### Why This Pattern

| Alternative | Problem |
|---|---|
| Inline `with trace(...)` next to each `Runner.run()` in orchestrator | Parallel specialists race on the `contextvar` the SDK uses to track current trace |
| No outer `with trace(...)` at all | Each `Runner.run()` creates its own disconnected top-level trace — fragments the dashboard |
| Manual `with agent_span(...)` wrapping | SDK already creates `agent_span` per `Runner.run()` — double-wrapping shows as `AgentName ▸ AgentName` |

### Do NOT

- ❌ Wrap `Runner.run()` in `with agent_span(...)` — the SDK does this automatically
- ❌ Create a new `trace_id` per specialist — they should share the parent workflow's trace
- ❌ Call `dataclasses.asdict()` on SDK event objects

---

## Streaming Lifecycle & Trace Reliability

### Problem

`Runner.run_streamed()` is more likely to lose traces than `Runner.run()` because:
- Stream may not be fully consumed (client disconnect)
- FastAPI cancels async generators aggressively on disconnect/timeout
- Trace exporter is async and buffered — may not flush before process moves on

### Required Pattern for All Streaming Generators

Every streaming endpoint generator in `app.py` MUST follow this structure:

```python
async def stream_events(...) -> AsyncIterator[str]:
    trace_id = new_trace_id()
    yield encode_event("trace_started", {...})

    try:
        with workflow_trace("Workflow Name", trace_id=trace_id, ...):
            result = Runner.run_streamed(agent, input=..., run_config=run_config(..., trace_id=trace_id))
            async for event in result.stream_events():
                yield encode_event(...)

            yield encode_event("trace_completed", {...})
            yield encode_event("done", {})

    except asyncio.CancelledError:
        logger.warning("Stream cancelled (client disconnect)")

    except Exception as exc:
        logger.exception("Stream failed")
        yield encode_event("error", error_payload(exc))

    finally:
        await flush_trace_exports()
```

### Key Requirements

1. **`try/except CancelledError`** — catches FastAPI generator cancellation on client disconnect
2. **`except Exception`** — catches and logs all other failures
3. **`finally: await flush_trace_exports()`** — ALWAYS runs, ensures buffered traces are exported
4. **Full stream exhaustion** — `async for event in result.stream_events()` must run to completion (no `break`, no early `return`)
5. **`flush_trace_exports()`** calls `force_flush()` on the SDK's trace processor + a short `asyncio.sleep(0.5)` to let the async exporter send

### What `flush_trace_exports()` Does

```python
async def flush_trace_exports() -> None:
    try:
        provider = get_trace_provider()
        processor = getattr(provider, "_multi_processor", None)
        if processor and hasattr(processor, "force_flush"):
            processor.force_flush()
        await asyncio.sleep(0.5)
    except Exception:
        pass
```

---

## Runtime Configuration

### Disabling Tracing

Set either of these environment variables:
- `OPENAI_AGENTS_DISABLE_TRACING=1`
- `OPENAI_AGENTS_TRACING_ENABLED=false`

### API Key for Tracing

If the OpenAI API key is set at runtime (via the UI), update both:

```python
os.environ["OPENAI_API_KEY"] = api_key
set_tracing_export_api_key(api_key)
```

The SDK exporter may have initialized before the runtime key existed.

### Sensitive Data

Use `OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA=false` to omit payload data from traces.

---

## Agent-to-Trace Mapping

All agents within a single HTTP request share one `trace_id`. The SDK nests each `Runner.run()` as an `agent_span` under the parent trace.

| Agent | Workflow Trace Name | Trigger |
|---|---|---|
| `MCP Chat Agent` | `MCP chat` | `/api/chat/stream` |
| `FinancialAnalysisAgent` | `Financial analysis` | `/api/financial-analysis/stream` |
| `ManagerPlannerAgent` | `Agentic task` | No skills selected + session exists |
| `SpecialistSkillAgent-{name}` | `Agentic task` | Per selected/planned skill (sequential) |
| `ManagerResearchAgent` | `Agentic task` | Fallback when no skills are relevant |
| `SkillPromptBuilderAgent` | `Skill prompt builder` | `/api/skills/draft` |
| `SkillVisualizationAgent-{name}` | `Skill visualizations` | `/api/visualizations/stream` |

### Expected Dashboard View

```
Agentic task (one trace)
  ├─ ManagerPlannerAgent (only if no skills selected + session)
  ├─ SpecialistSkillAgent-A
  ├─ SpecialistSkillAgent-B
  └─ (no ManagerAgent — per-skill output streamed directly)

Skill visualizations (separate trace, triggered by button)
  ├─ SkillVisualizationAgent-A → ImageGenerationTool
  └─ SkillVisualizationAgent-B → ImageGenerationTool
```

---

## Skill Execution Workflows

### WF1: User Selects Skills

1. User picks 1–5 skills and submits a question
2. Backend skips the planner — runs only selected skills as specialists
3. Specialists run **sequentially**, streaming text in real time per skill
4. Each skill's output appears as a `## Skill Name` section in the streamed answer

### WF2: No Skills Selected, No Session

1. User submits a question without selecting skills and without a chat session
2. Backend defaults to ALL active skills (up to 5)
3. Same sequential execution as WF1

### WF3: No Skills Selected, With Session

1. User submits a question without selecting skills but within a chat session
2. `ManagerPlannerAgent` runs to pick relevant skills from all active skills
3. If planner finds relevant skills → sequential execution as WF1
4. If planner says no skills are relevant → `ManagerResearchAgent` answers directly

### Image Generation (all workflows)

- Triggered by "Generate Images" button after an answer is displayed
- One `SkillVisualizationAgent` per required skill
- Runs under a separate `Skill visualizations` trace
- Each agent has `ImageGenerationTool` and generates one chart/infographic

---

## Debugging Traces

### Traces appear in Responses but not Agent Traces

Check:
1. Is `with trace(...)` wrapping the `Runner.run()` call? (check `app.py`)
2. Is `run_config(trace_id=...)` passing the same trace_id?
3. Is `flush_trace_exports()` called in `finally`?
4. Is the stream fully consumed? (no early `break` or `return`)
5. Is `asyncio.CancelledError` being caught?

### Traces randomly missing

Likely cause: async exporter flush race. The `finally: await flush_trace_exports()` fix addresses this.

### Double agent names in dashboard (`Agent ▸ Agent`)

Cause: manual `with agent_span(...)` wrapping. Remove it — the SDK handles this.

### Logs in Docker

```sh
docker compose logs chat-api --tail 50
```

Development mode (`APP_ENV` unset) includes `error_type` and `traceback` in streamed error events.

---

## Rule Of Thumb

- Do not deep-copy Agents SDK stream event objects
- Do not manually create `agent_span` — let `Runner.run()` handle it
- Always wrap streaming generators in `try/except CancelledError/finally`
- Always call `flush_trace_exports()` in `finally`
- One `with trace(...)` per HTTP request, all Runner calls inside share it

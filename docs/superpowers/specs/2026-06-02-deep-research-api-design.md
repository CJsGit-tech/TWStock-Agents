# Deep Research API Design

Date: 2026-06-02

## Summary

Add a general-purpose Deep Research streaming API to the backend. The API accepts a research topic plus optional caller instructions, dynamically plans specialist research agents, runs those agents with web search, validates the gathered evidence against the user's intent, and streams a final source-backed synthesis.

This is a separate API from the active chatbot route. The chatbot remains a plain GPT-5 chat endpoint with MCP tools only when configured. Deep Research gets its own route, package, request schema, orchestration service, and tests.

## Goals

- Provide a general-purpose research workflow for any topic.
- Allow callers to pass an optional `system_prompt` for domain framing, style, or constraints.
- Stream progress and final output as NDJSON.
- Use Agents SDK `WebSearchTool` in the research agents.
- Keep the workflow stateless in v1.
- Use one shared `trace_id` across planner, specialists, reviewer, and synthesizer.
- Keep the implementation isolated from `/api/chatbot/stream`.

## Non-Goals

- Do not add persistence for research runs in v1.
- Do not couple the endpoint to portfolios, Taiwan stocks, or chat sessions in v1.
- Do not add image generation in v1.
- Do not change the existing chatbot API contract.

## Public API

### `POST /api/deep-research/stream`

Streams `application/x-ndjson`.

Example request:

```json
{
  "topic": "Compare the latest AI browser products and their monetization strategies",
  "system_prompt": "Focus on product strategy and cite sources clearly.",
  "research_depth": "standard",
  "max_agents": 4
}
```

### Request Fields

- `topic`: Required non-empty string. The user's research question.
- `system_prompt`: Optional string. Extra caller instructions for framing, domain constraints, output style, or validation criteria.
- `research_depth`: Optional enum. Defaults to `standard`. Supported values are `quick`, `standard`, and `deep`.
- `max_agents`: Optional integer. Defaults from `research_depth` and is capped at a safe maximum, initially 6.

The backend's structural requirements still apply even when `system_prompt` is provided: cite sources, distinguish facts from inferences, report uncertainty, and avoid unsupported claims.

## Backend Architecture

Add:

- `backend/api/deep_research.py`
- `backend/deep_research/__init__.py`
- `backend/deep_research/schemas.py`
- `backend/deep_research/service.py`
- `backend/deep_research/prompts.py`
- `backend/tests/test_deep_research.py`

Update:

- `backend/api/__init__.py` to export the new router.
- `backend/app.py` to include the new router and OpenAPI tag.
- `docs/API_EXAMPLES.md` to document the new endpoint and event stream.

`schemas.py` owns request validation and typed event payload helpers.

`prompts.py` owns default Manager Planner, Specialist Researcher, Manager Reviewer, and Manager Synthesizer instructions.

`service.py` owns agent construction, orchestration, trace handling, fallback behavior, and NDJSON event streaming.

## Workflow

The service creates one `trace_id` when a request starts and emits `trace_started`.

Inside a single outer `workflow_trace("DeepResearch", trace_id=trace_id, metadata=...)` block:

1. Manager Planner receives `topic`, `system_prompt`, `research_depth`, and `max_agents`.
2. Manager Planner returns a JSON plan with specialist roles, search angles, and validation criteria.
3. The service validates the plan and bounds the number of specialists.
4. Specialist Research Agents run with `WebSearchTool`, preferably concurrently with a bounded limit.
5. The service collects findings, source summaries, caveats, and failed-agent notes.
6. Manager Reviewer checks source coverage, conflicts, uncertainty, and alignment with the original topic and `system_prompt`.
7. Manager Synthesizer streams the final report.

Every `Runner.run_streamed` or `Runner.run` call receives `run_config(... trace_id=trace_id ...)`, so all child agent activity is grouped under the same trace.

## Agents

### Manager Planner

Plans focused research work. It outputs strict JSON:

```json
{
  "specialists": [
    {
      "agent_id": "market_landscape",
      "name": "Market Landscape Researcher",
      "research_angle": "Compare major products and positioning.",
      "rationale": "The topic asks for product comparison."
    }
  ],
  "validation_criteria": [
    "Answer the original topic directly.",
    "Separate sourced facts from inference."
  ]
}
```

### Specialist Research Agents

Each specialist receives one research angle and uses `WebSearchTool`. Specialists return concise findings, source references, caveats, and whether they found enough evidence.

### Manager Reviewer

Reviews all specialist outputs. It identifies evidence gaps, conflicts, unsupported claims, uncertainty, and whether synthesis can proceed confidently.

### Manager Synthesizer

Streams the final answer as Markdown. It must include key concepts, source-backed claims, uncertainty notes, and follow-up questions when the user's intent is underspecified.

## Stream Events

The endpoint streams NDJSON. Clients must ignore unknown future event types.

Core events:

- `trace_started`: Includes `trace_id`, `trace_url`, workflow name, depth, and selected model.
- `planning_started`: Manager planning begins.
- `planning_completed`: Includes selected specialists, research angles, and rationales.
- `specialist_started`: One event per specialist.
- `specialist_delta`: Optional text deltas from a specialist, tagged by `agent_id` and `agent_name`.
- `specialist_completed`: Includes findings, sources, caveats, enough-evidence flag, and optional error.
- `review_started`: Manager review begins.
- `review_completed`: Includes gaps, conflicts, uncertainty notes, and confidence.
- `message_started`: Final synthesis begins.
- `text_delta`: Final report text delta.
- `message_completed`: Final report content.
- `error`: Structured safe error payload.

Simple clients can concatenate only `text_delta`. Rich clients can render a research timeline.

## Error Handling

If `OPENAI_API_KEY` is missing, emit an `error` event and do not call `Runner`.

If Manager Planner returns invalid JSON, fall back to one general-purpose research specialist instead of aborting.

If one specialist fails, emit `specialist_completed` with `error` and continue with successful findings.

If all specialists fail, emit `error` and stop before final synthesis.

Development tracebacks may be included only when the existing backend development-error policy allows them.

## Testing

Add `backend/tests/test_deep_research.py` covering:

- `DeepResearchRequest` validation for `topic`, `research_depth`, and `max_agents`.
- Agent construction includes `WebSearchTool` for research agents.
- The same `trace_id` is passed to planner, specialists, reviewer, and synthesizer run configs.
- Successful event order.
- Invalid planner JSON falls back to one general-purpose specialist.
- Partial specialist failure still reaches review and synthesis.
- Missing API key emits an `error` and does not call `Runner`.

Run the backend test suite before claiming implementation complete:

```bash
python -m unittest discover backend/tests -v
```

## Implementation Boundaries

Keep the Deep Research code isolated from chatbot internals except for small shared utilities that are already stable, such as trace helpers or safe error formatting patterns.

Do not reuse `skill_agents` directly for v1. It is skill-centric and finance-biased. The new package can reuse the same general orchestration ideas: planner, specialists, manager review, streamed events, and explicit tool construction.

Do not add database models until there is a concrete UI or product requirement for saved research artifacts.

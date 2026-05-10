# Current Architecture Design

## Purpose

This project runs a Docker Compose based MCP chatbot with Python FastMCP MCP servers:

- `chat-web`: React/Vite chatbot frontend.
- `chat-api`: FastAPI backend that uses the Python OpenAI Agents SDK.
- `postgres`: Stores user-created agent skills and chat-session JSON snapshots.
- `arithmetic-mcp-fastmcp`: Python FastMCP server exposing arithmetic tools over streamable HTTP.
- `twstock-mcp-fastmcp`: Python FastMCP server exposing Taiwan stock tools powered by `twstock`.

The frontend streams assistant text into the chat bubble while the left Activity Rail switches between Chat Sessions and Event Logs. Event Logs are grouped by saved chat session, then by assistant round; deleting a round log removes only that round's event/activity metadata, not the chat transcript.

## Key Architecture Decisions

### OpenAI Agents SDK + MCP Event Serialization

Agents SDK stream event objects are live runtime objects. Do not deep-copy or call `dataclasses.asdict(...)` on them; nested agent/MCP references can include asyncio primitives such as `_asyncio.Future`, which are not pickle/deepcopy safe. Event serializers must use shallow dataclass traversal and stringify unknown runtime objects.

MCP-backed Agents SDK runs keep hosted tracing enabled by default and use top-level `trace(...)` wrappers so workflows appear in the OpenAI Platform Traces dashboard. Set `OPENAI_AGENTS_DISABLE_TRACING=1` or `OPENAI_AGENTS_TRACING_ENABLED=false` only when traces should be intentionally disabled.

See [OpenAI Agents SDK + MCP Notes](./OPENAI_AGENTS_SDK_MCP_NOTES.md) before adding new MCP-backed agent runs.

### MCP Servers: Python FastMCP

- Same language family as `chat-api`.
- Faster to extend for future stock-research tools.
- Supports network-based streamable HTTP MCP transport for Docker Compose.
- SSE remains a legacy compatibility option; streamable HTTP is the default.

### Financial Analysis: Agent-Owned Tool Calling

The financial analysis workflow uses the OpenAI Agents SDK's native tool-calling loop. The frontend detects financial-analysis prompts, extracts the best available stock input from the prompt or recent messages, and routes those requests to `POST /api/financial-analysis/stream`. The backend is a thin orchestration layer:

1. Normalize the submitted stock input.
2. Create a `FinancialAnalysisAgent` with MCP twstock tools + WebSearch.
3. Pass the user's question to the agent via `Runner.run_streamed`.
4. The **agent decides** which MCP tools to call, in what order, and how many times.
5. Stream events (text, reasoning, tool calls, tool outputs) to the frontend.

There is no backend-side data collection or section inference. The backend builds only a small agent prompt from `stock`, `question`, and optional recent chat `context`; the model owns all tool-calling decisions.

Financial analysis no longer auto-generates images. Visual artifacts are produced only by the explicit per-answer **Generate Images** action, which calls `POST /api/visualizations/stream`.

### Dynamic Skills: Manager-Planned Specialists

The agentic task workflow stores reusable skills in Postgres. A skill contains a name, description, and specialist instructions. Tool access is global:

- Every specialist and skill-draft agent connects to all available MCP servers.
- Specialist and research agents get built-in WebSearch.
- Image generation is intentionally isolated to dedicated skill visualization agents invoked by `POST /api/visualizations/stream`.
- If the user selected skills, those skills are the exact execution set. No planner runs.
- If the user selected no skills and has a session, the Manager Planner picks relevant skills.
- If the user selected no skills and has no session, ALL active skills run.

`POST /api/agentic-task/stream` loads all active skills, determines the execution set based on the three workflow paths (WF1/WF2/WF3), runs specialists **sequentially** streaming each one's text output in real time, then emits a `manager_completed` event. There is no Manager synthesis agent — each skill's output is streamed directly as a Markdown section (`## Skill Name`).

If no skill matches and no required skills were selected, the backend runs a direct Manager Research Agent.

## Agent Inventory And Trace Map

All agents within a single HTTP request share one `trace_id`. The SDK auto-creates an `agent_span` per `Runner.run()` call nested under the parent trace. No manual `agent_span` wrapping is used.

| Agent | Trigger / Endpoint | Tools | Trace Name |
| --- | --- | --- | --- |
| `MCP Chat Agent` | `POST /api/chat/stream` | Arithmetic MCP, twstock MCP | `MCP chat` |
| `FinancialAnalysisAgent` | `POST /api/financial-analysis/stream` | twstock MCP, WebSearch | `Financial analysis` |
| `ManagerPlannerAgent` | `POST /api/agentic-task/stream` (WF3 only) | All MCP servers, WebSearch | `Agentic task` |
| `SpecialistSkillAgent-{name}` | `POST /api/agentic-task/stream` | All MCP servers, WebSearch | `Agentic task` |
| `ManagerResearchAgent` | `POST /api/agentic-task/stream` (fallback) | All MCP servers, WebSearch | `Agentic task` |
| `SkillPromptBuilderAgent` | `POST /api/skills/draft` | All MCP servers, WebSearch | `Skill prompt builder` |
| `SkillVisualizationAgent-{name}` | `POST /api/visualizations/stream` | `ImageGenerationTool` | `Skill visualizations` |

### Expected Dashboard View

```
Agentic task (one trace per request)
  ├─ ManagerPlannerAgent (WF3 only)
  ├─ SpecialistSkillAgent-A (agent_span, auto-created by SDK)
  └─ SpecialistSkillAgent-B (agent_span, auto-created by SDK)

Skill visualizations (separate trace, button-triggered)
  ├─ SkillVisualizationAgent-A → ImageGenerationTool
  └─ SkillVisualizationAgent-B → ImageGenerationTool
```

### Streaming Lifecycle

All streaming generators follow the pattern:

```
try → with trace(...) → Runner.run_streamed → full stream consumption → done
except CancelledError → log warning
except Exception → log + yield error event
finally → flush_trace_exports()
```

This ensures traces are exported even on client disconnect. See `docs/OPENAI_AGENTS_SDK_MCP_NOTES.md` for the full checklist.

The Manager Planner is not executed in the selected-skill path. It is only executed when the user submits a question with no selected skills.

For image generation, the visualization endpoint creates the top-level `Skill visualizations` trace and runs one `SkillVisualizationAgent-{skill.name}` per required skill. Hosted image-generation calls should appear under those visualization agent runs. The app should not create a nested `trace(...)` or custom `ImageGenerationTool` span around the hosted tool call unless debugging the tracing exporter itself.

```mermaid
flowchart TD
    U["User prompt"] --> UI["Frontend"]
    UI -->|"POST /api/agentic-task/stream"| T1["trace: Agentic task"]
    T1 --> D{"Required skills selected?"}
    D -->|"yes"| R["Use exactly selected skills"]
    D -->|"no"| P["ManagerPlannerAgent chooses relevant skills"]
    R --> S["trace: Skill agent: {skill.name}<br/>SpecialistSkillAgent-{skill.name}"]
    P --> S
    S --> M["ManagerAgent in trace: Agentic task"]
    M --> A["Final markdown answer"]
    A --> UI
    UI -->|"User clicks Generate Images"| T2["trace: Skill visualizations"]
    T2 --> V1["SkillVisualizationAgent-{required skill 1}"]
    T2 --> V2["SkillVisualizationAgent-{required skill 2}"]
    V1 --> IMG["ImageGenerationTool"]
    V2 --> IMG
    IMG --> G["Image gallery on same answer"]
```

Dashboard trace names used by this app:

- `MCP chat`
- `Financial analysis`
- `Agentic task`
- `Skill prompt builder`
- `Skill visualizations`

## System Diagram

```mermaid
flowchart LR
    user[User Browser]

    subgraph compose[Docker Compose Project]
        web[chat-web<br/>React + Vite<br/>Port 5173]
        api[chat-api<br/>FastAPI + OpenAI Agents SDK<br/>Port 8000]
        db[(postgres<br/>skills + chat_sessions tables<br/>Port 5432)]
        arithmetic[arithmetic-mcp-fastmcp<br/>Python FastMCP Arithmetic Server<br/>Port 8080]
        twstock[twstock-mcp-fastmcp<br/>Python FastMCP twstock Server<br/>Port 8081]
    end

    openai[OpenAI API]

    user -->|Open app| web
    web -->|Skill CRUD| api
    api -->|Read/write skills| db
    web -->|POST /api/chat/stream<br/>or /api/financial-analysis/stream<br/>or /api/agentic-task/stream<br/>or /api/visualizations/stream<br/>NDJSON response stream| api
    api -->|MCP streamable HTTP<br/>/mcp| arithmetic
    api -->|MCP streamable HTTP<br/>/mcp| twstock
    api -->|Agent + WebSearch<br/>or explicit ImageGeneration| openai
    api -->|Model request + streaming events| openai
    openai -->|Text, reasoning, tool orchestration events| api
    arithmetic -->|Tool results<br/>addition/subtraction/multiplication/divide| api
    twstock -->|Taiwan stock metadata, quotes,<br/>historical data, moving averages, signals| api
    api -->|text_delta, reasoning_event,<br/>tool_called, tool_output, error| web
    web -->|Assistant bubble + Activity Rail logs| user
```

## Agentic Task Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant DB as Postgres
    participant P as ManagerPlanner
    participant S as Specialist Agents
    participant T as MCP/Built-in Tools
    participant M as ManagerAgent

    U->>W: Select 0-5 required skills + submit prompt
    W->>A: POST /api/agentic-task/stream
    A->>DB: Load all active skills
    DB-->>A: Required + candidate skills
    A-->>W: manager_planning_started
    alt Required skills selected
        A->>A: Use exactly required skills, max 5 total
    else No required skills selected
        A->>P: Choose relevant skills from all active skills
        P->>T: Use all available MCP + WebSearch as needed
        P-->>A: Execution plan, max 5 total
    end
    A-->>W: execution_plan_created
    par Specialist fan-out
        A->>S: Run one agent per skill in its own trace
        S->>T: Use all MCP servers + WebSearch
        T-->>S: Tool results
        S-->>A: Markdown specialist output
    end
    A-->>W: specialist lifecycle/tool events
    A->>M: Synthesize specialist outputs
    M-->>A: Final Markdown answer
    A-->>W: text_delta, manager_completed, done
```

## Financial Analysis Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant FA as FinancialAnalysisAgent
    participant O as OpenAI API
    participant T as twstock MCP

    U->>W: "完整分析 2330 台積電"
    W->>A: POST /api/financial-analysis/stream
    A->>FA: Create agent with MCP tools + WebSearch
    FA->>O: User question + available tools
    O-->>FA: Call get_stock_info(2330)
    FA->>T: MCP tool call
    T-->>FA: Stock metadata
    O-->>FA: Call get_realtime_quote(2330)
    FA->>T: MCP tool call
    T-->>FA: Quote data
    O-->>FA: WebSearch for financial data
    Note over FA: Agent decides what else to fetch...
    O-->>FA: Generate analysis text
    FA-->>A: Stream text_delta, reasoning, tool events
    A-->>W: NDJSON stream
    W-->>U: Render report + event history
```

## Button-Triggered Visualization Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant DB as Postgres
    participant V as SkillVisualizationAgent
    participant O as OpenAI API

    U->>W: Click Generate Images on completed answer
    W->>A: POST /api/visualizations/stream
    A->>DB: Load required skills saved on the answer
    DB-->>A: Required skills
    loop One image per required skill
        A->>V: Create skill visualization agent with ImageGenerationTool
        V->>O: Skill-specific image prompt + final answer
    end
    O-->>V: image_generation_call result
    V-->>A: image_generated
    A-->>W: NDJSON stream
    W-->>U: Render image gallery on the answer + event history
```

## Chat Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant O as OpenAI API
    participant M as arithmetic-mcp-fastmcp
    participant T as twstock-mcp-fastmcp

    U->>W: Submit chat message
    W->>A: POST /api/chat/stream
    A->>M: Connect MCPServerStreamableHttp to /mcp
    M-->>A: Tool list ready
    A->>T: Connect MCPServerStreamableHttp to /mcp
    T-->>A: Tool list ready
    A-->>W: mcp_ready
    A->>O: Run MCP Chat Agent
    O-->>A: text_delta / reasoning events
    A-->>W: Stream normalized NDJSON events
    O->>A: Request tool call
    A-->>W: tool_called
    A->>M: Invoke MCP tool
    M-->>A: Result
    A-->>W: tool_output
    O-->>A: Final assistant text
    A-->>W: text_delta, done
    W-->>U: Render response and event history
```

## Runtime Services

| Service | Container | Port | Responsibility |
| --- | --- | --- | --- |
| `chat-web` | `arithmetic-mcp-chat-web` | `5173` | Browser UI for chat, sessions, required skills, image gallery, and session-grouped event logs. |
| `postgres` | `twstock-agents-postgres` | `5432` | Stores active/soft-deleted skills and chat-session JSON snapshots. |
| `chat-api` | `arithmetic-mcp-chat-api` | `8000` | Keeps `OPENAI_API_KEY` server-side, runs agents, streams normalized events to the frontend. |
| `arithmetic-mcp-fastmcp` | `arithmetic-mcp-fastmcp` | `8080` | Python FastMCP server exposing `addition`, `subtraction`, `multiplication`, and `divide`. |
| `twstock-mcp-fastmcp` | `twstock-mcp-fastmcp` | `8081` | Python FastMCP server exposing Taiwan stock tools. |

## Important Endpoints

| Endpoint | Owner | Use |
| --- | --- | --- |
| `GET /` | `chat-web` | Serves the React application. |
| `GET /api/health` | `chat-api` | Backend health check. |
| `GET /api/mcp/tools` | `chat-api` | Lists tools discovered from MCP servers. |
| `GET /api/skills` | `chat-api` | Lists active skills. |
| `POST /api/skills` | `chat-api` | Creates a skill. |
| `POST /api/skills/draft` | `chat-api` | Generates an unsaved skill draft for user review. |
| `PUT /api/skills/{id}` | `chat-api` | Updates a skill. |
| `DELETE /api/skills/{id}` | `chat-api` | Soft-deletes a skill. |
| `POST /api/chat/stream` | `chat-api` | Main chatbot endpoint; returns NDJSON events. |
| `POST /api/financial-analysis/stream` | `chat-api` | Financial analysis endpoint; returns NDJSON events. |
| `POST /api/agentic-task/stream` | `chat-api` | Dynamic skill-backed manager workflow; returns NDJSON events. |
| `POST /api/visualizations/stream` | `chat-api` | Explicit per-answer skill visualization workflow; returns NDJSON events. |
| `GET /api/chat-sessions` | `chat-api` | Lists active chat sessions. |
| `POST /api/chat-sessions` | `chat-api` | Creates a chat session snapshot. |
| `GET /api/chat-sessions/{id}` | `chat-api` | Loads a chat session with message/event JSON. |
| `PUT /api/chat-sessions/{id}` | `chat-api` | Updates message/event JSON snapshots, including round-log deletion. |
| `DELETE /api/chat-sessions/{id}` | `chat-api` | Soft-deletes a chat session. |
| `/mcp` | MCP servers | FastMCP streamable HTTP transport endpoint. |

## twstock MCP Tools

| Tool | Purpose |
| --- | --- |
| `get_stock_info(stock_id)` | Read stock metadata from `twstock.codes`. |
| `get_realtime_quote(stock_id)` | Fetch realtime quote data for one Taiwan stock. |
| `get_realtime_quotes(stock_ids)` | Fetch realtime quote data for multiple Taiwan stocks. |
| `get_historical_data(stock_id, year, month)` | Fetch historical OHLC trading data. |
| `calculate_moving_average(stock_id, days)` | Calculate a moving average from recent closing prices. |
| `analyze_best_four_point(stock_id)` | Run `twstock.BestFourPoint` buy/sell/neutral technical signal logic. |

## Event Contract

`chat-api` emits one JSON object per line.

- `text_delta`: appended to the assistant message bubble.
- `reasoning_delta`: shown in the Activity Rail Event Logs tab.
- `reasoning_event`: shown in the Activity Rail Event Logs tab.
- `tool_called`: shown in the Activity Rail Event Logs tab.
- `tool_output`: shown in the Activity Rail Event Logs tab.
- `agent_started`: a specialist agent has started.
- `agent_completed`: a specialist agent completed.
- `manager_planning_started`: the Manager Planner is choosing the execution set.
- `execution_plan_created`: required and manager-selected skills are finalized.
- `skill_selected_by_manager`: an optional skill was added by the Manager Planner.
- `skill_skipped_by_manager`: an active skill was intentionally skipped.
- `no_relevant_skills`: no active skill matched, so direct manager research is used.
- `manager_started`: a manager workflow started.
- `manager_completed`: the manager synthesis completed.
- `specialist_started`: a required or manager-selected skill agent started.
- `specialist_completed`: a required or manager-selected skill agent completed.
- `image_generation_started`: explicit skill visualization started producing an image artifact.
- `image_generated`: explicit skill visualization produced an image artifact.
- `trace_started` / `trace_completed`: the backend created or completed an OpenAI Traces workflow and includes the trace id/dashboard URL.
- `error`: shown in the Activity Rail Event Logs tab. Stream-level fetch/parse failures are also appended to the assistant message.
- `mcp_ready`: ignored by the frontend Event Logs UI.
- `done`: ignored by the frontend Event Logs UI.

## Configuration

Docker Compose reads `.env` from the project root:

```sh
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"              # Default chat model
FINANCIAL_ANALYSIS_MODEL="gpt-5-mini"  # Financial analyst model
FINANCIAL_ANALYSIS_WEB_CONTEXT="medium"
OPENAI_IMAGE_MODEL="gpt-image-2"       # Image generation model
OPENAI_IMAGE_QUALITY="medium"
OPENAI_AGENTS_TRACING_ENABLED="true"   # Tracing is enabled by default
OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA="true"
DATABASE_URL="postgresql+psycopg://twstock:twstock@postgres:5432/twstock_agents"
SKILLS_DB_AUTO_INIT="true"
```

MCP server URLs (set automatically in Docker Compose):

```sh
MCP_HTTP_URL=http://arithmetic-mcp-fastmcp:8080/mcp
TWSTOCK_MCP_HTTP_URL=http://twstock-mcp-fastmcp:8081/mcp
```

## Backend Code Structure

```
backend/
├── app.py                          # FastAPI routes, MCP server setup, chat agent
├── agent_tracing.py                # Shared trace helpers and RunConfig factory
├── alembic/                        # Skill and chat-session migrations
├── financial_agents/
│   ├── __init__.py                 # Exports run_financial_analysis, FinancialAnalysisRequest
│   ├── agents.py                   # FinancialAnalysisAgent plus legacy/dedicated visualization factory
│   ├── orchestrator.py             # Thin orchestration: parse request → run analyst agent → stream events
│   └── schemas.py                  # Pydantic models (FinancialAnalysisRequest, SpecialistResult, etc.)
├── skill_agents/
│   ├── db.py                       # SQLAlchemy engine/session and startup initialization
│   ├── models.py                   # Skill and ChatSession ORM models
│   ├── orchestrator.py             # Dynamic specialist fan-out, manager synthesis, skill visualizations
│   ├── schemas.py                  # Skill CRUD, chat session, agentic task, visualization schemas
│   └── seeds.py                    # Seven default skills
└── tests/
    ├── test_app_settings.py
    ├── test_financial_agents.py
    └── test_skill_agents.py
```

## Start And Verify

```sh
docker compose up --build -d
curl -i http://localhost:5173
curl -i http://localhost:8000/api/health
curl -i http://localhost:8080/healthz
curl -i http://localhost:8081/healthz
```

Open the app: http://localhost:5173

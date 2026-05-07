# Current Architecture Design

## Purpose

This project runs a Docker Compose based MCP chatbot with Python FastMCP MCP servers:

- `chat-web`: React/Vite chatbot frontend.
- `chat-api`: FastAPI backend that uses the Python OpenAI Agents SDK.
- `postgres`: Stores user-created agent skills.
- `arithmetic-mcp-fastmcp`: Python FastMCP server exposing arithmetic tools over streamable HTTP.
- `twstock-mcp-fastmcp`: Python FastMCP server exposing Taiwan stock tools powered by `twstock`.

The frontend streams assistant text into the chat bubble while showing reasoning and tool events in a right-side event history panel grouped by chat round.

## Key Architecture Decisions

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

For visualization requests (detected by keyword match in the financial orchestrator), a separate `FinancialVisualizationAgent` with `ImageGenerationTool` generates chart images from numeric lines already present in recent chat context.

### Dynamic Skills: Manager-Planned Specialists

The agentic task workflow stores reusable skills in Postgres. A skill contains a name, description, and specialist instructions. Tool access is global:

- Every planner, specialist, manager, fallback, and skill-draft agent connects to all available MCP servers.
- Every agent gets built-in WebSearch and ImageGeneration.
- User-selected skills are required skills, not the full execution set.
- The Manager Planner can add relevant optional skills from all active skills, up to five total executed skills.

`POST /api/agentic-task/stream` loads all active skills, plans the execution set, runs specialists concurrently when relevant skills exist, then passes their Markdown outputs to a `ManagerAgent`. If no skill matches and no required skills were selected, the backend skips specialists, runs a direct Manager Research Agent, and suggests creating a new skill.

## System Diagram

```mermaid
flowchart LR
    user[User Browser]

    subgraph compose[Docker Compose Project]
        web[chat-web<br/>React + Vite<br/>Port 5173]
        api[chat-api<br/>FastAPI + OpenAI Agents SDK<br/>Port 8000]
        db[(postgres<br/>skills table<br/>Port 5432)]
        arithmetic[arithmetic-mcp-fastmcp<br/>Python FastMCP Arithmetic Server<br/>Port 8080]
        twstock[twstock-mcp-fastmcp<br/>Python FastMCP twstock Server<br/>Port 8081]
    end

    openai[OpenAI API]

    user -->|Open app| web
    web -->|Skill CRUD| api
    api -->|Read/write skills| db
    web -->|POST /api/chat/stream<br/>or /api/financial-analysis/stream<br/>or /api/agentic-task/stream<br/>NDJSON response stream| api
    api -->|MCP streamable HTTP<br/>/mcp| arithmetic
    api -->|MCP streamable HTTP<br/>/mcp| twstock
    api -->|Agent + WebSearch + ImageGen| openai
    api -->|Model request + streaming events| openai
    openai -->|Text, reasoning, tool orchestration events| api
    arithmetic -->|Tool results<br/>addition/subtraction/multiplication/divide| api
    twstock -->|Taiwan stock metadata, quotes,<br/>historical data, moving averages, signals| api
    api -->|text_delta, reasoning_event,<br/>tool_called, tool_output, error| web
    web -->|Assistant bubble + event panel| user
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
    A->>P: Plan required + optional skills
    P->>T: Use all available MCP/built-in tools as needed
    P-->>A: Execution plan, max 5 total
    A-->>W: execution_plan_created
    par Specialist fan-out
        A->>S: Run one agent per skill
        S->>T: Use all MCP servers and built-in tools
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

## Visualization Flow

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant V as FinancialVisualizationAgent
    participant O as OpenAI API

    U->>W: "用剛才的資料畫一張圖"
    W->>A: POST /api/financial-analysis/stream with stock, question, context
    A->>A: Detect visualization keyword
    A->>A: Extract numeric-heavy lines from recent context
    A->>V: Create visualization agent with ImageGenerationTool
    V->>O: Chart request + extracted context data
    O-->>V: image_generation_call result
    V-->>A: image_generated
    A-->>W: NDJSON stream
    W-->>U: Render image attachment + event history
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
| `chat-web` | `arithmetic-mcp-chat-web` | `5173` | Browser UI for chat, streaming assistant text, and round-grouped event history. |
| `postgres` | `twstock-agents-postgres` | `5432` | Stores active and soft-deleted skills. |
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
- `reasoning_delta`: shown in the event history panel.
- `reasoning_event`: shown in the event history panel.
- `tool_called`: shown in the event history panel.
- `tool_output`: shown in the event history panel.
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
- `image_generated`: the visualization agent produced an image.
- `error`: shown in the event history panel. Stream-level fetch/parse failures are also appended to the assistant message.
- `mcp_ready`: ignored by the frontend event panel.
- `done`: ignored by the frontend event panel.

## Configuration

Docker Compose reads `.env` from the project root:

```sh
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"              # Default chat model
FINANCIAL_ANALYSIS_MODEL="gpt-5-mini"  # Financial analyst model
FINANCIAL_ANALYSIS_WEB_CONTEXT="medium"
OPENAI_IMAGE_MODEL="gpt-image-1"       # Image generation model
OPENAI_IMAGE_QUALITY="low"
ENABLE_FINANCIAL_IMAGE="true"          # Optional; defaults to true in code
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
├── alembic/                        # Skill table migration
├── financial_agents/
│   ├── __init__.py                 # Exports run_financial_analysis, FinancialAnalysisRequest
│   ├── agents.py                   # Agent definitions (FinancialAnalysisAgent, FinancialVisualizationAgent)
│   ├── orchestrator.py             # Thin orchestration: parse request → run agent → stream events
│   └── schemas.py                  # Pydantic models (FinancialAnalysisRequest, SpecialistResult, etc.)
├── skill_agents/
│   ├── db.py                       # SQLAlchemy engine/session and startup initialization
│   ├── models.py                   # Skill ORM model
│   ├── orchestrator.py             # Dynamic specialist fan-out and manager synthesis
│   ├── schemas.py                  # Skill CRUD and agentic task request schemas
│   └── seeds.py                    # Seven default skills
└── tests/
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

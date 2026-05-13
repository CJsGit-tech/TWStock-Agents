# TWStock Agents TEST

Docker Compose app for MCP-backed arithmetic tools, Taiwan stock tools, and a streamlined financial-analysis workflow.

Identifiable MCP server name: `arithmetic-mcp-fastmcp`

Containerized Python FastMCP arithmetic server exposing four arithmetic tools:

- `addition(a, b)`
- `subtraction(a, b)`
- `multiplication(a, b)`
- `divide(a, b)`

The server exposes:

- Streamable HTTP MCP endpoint: `http://localhost:8080/mcp`
- Health check: `http://localhost:8080/healthz`

The stack also includes a Taiwan stock MCP server powered by `twstock`:

- Streamable HTTP MCP endpoint: `http://localhost:8081/mcp`
- Health check: `http://localhost:8081/healthz`
- Tools:
  - `get_stock_info(stock_id)`
  - `get_realtime_quote(stock_id)`
  - `get_realtime_quotes(stock_ids)`
  - `get_historical_data(stock_id, year, month)`
  - `calculate_moving_average(stock_id, days)`
  - `analyze_best_four_point(stock_id)`

The React chatbot stack adds:

- Chat UI: `http://localhost:5173`
- Chat API: `http://localhost:8000/api/health`
- Financial analysis stream: `POST http://localhost:8000/api/financial-analysis/stream`
- Skill-backed agentic task stream: `POST http://localhost:8000/api/agentic-task/stream`
- Button-triggered visualization stream: `POST http://localhost:8000/api/visualizations/stream`
- Skill CRUD API: `GET/POST/PUT/DELETE http://localhost:8000/api/skills`
- Chat session API: `GET/POST/PUT/DELETE http://localhost:8000/api/chat-sessions`

## Run With Docker Compose

Create a `.env` file in this folder with your OpenAI API key:

```sh
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
FINANCIAL_ANALYSIS_MODEL="gpt-5-mini"
FINANCIAL_ANALYSIS_WEB_CONTEXT="medium"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_IMAGE_QUALITY="medium"
OPENAI_AGENTS_TRACING_ENABLED="true"
OPENAI_AGENTS_TRACE_INCLUDE_SENSITIVE_DATA="true"
DATABASE_URL="postgresql+psycopg://twstock:twstock@postgres:5432/twstock_agents"
```

Only `OPENAI_API_KEY` is required. The other variables are optional. Agents SDK tracing is enabled by default; set `OPENAI_AGENTS_TRACING_ENABLED=false` or `OPENAI_AGENTS_DISABLE_TRACING=1` only when you intentionally want to stop uploads to the OpenAI Traces dashboard.

Start the full MCP chatbot stack:

```sh
docker compose up --build
```

Start it in the background:

```sh
docker compose up --build -d
```

Check health:

```sh
curl -i http://localhost:8080/healthz
curl -i http://localhost:8000/api/health
```

Stop it:

```sh
docker compose down
```

Open the frontend at `http://localhost:5173`.

The Compose stack starts five services:

- `postgres`: Postgres database for user-created skills and chat-session snapshots.
- `arithmetic-mcp-fastmcp`: Python FastMCP arithmetic server.
- `twstock-mcp-fastmcp`: Python FastMCP Taiwan stock server powered by `twstock`.
- `chat-api`: Python FastAPI bridge using the OpenAI Agents SDK and the MCP server.
- `chat-web`: React/Vite chatbot UI with chat sessions, session-grouped event logs, required skills, and image galleries.

## Skill-Backed Agentic Tasks

The app supports dynamic specialist skills stored in Postgres. A skill contains a name, description, and reusable instructions. The UI can create/edit/delete skills, mark up to five skills as required, and submit a manager-planned workflow:

```sh
curl -N http://localhost:8000/api/agentic-task/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"分析 2330 的估值與買進策略","stock":"2330","required_skill_ids":["..."]}'
```

The workflow:

- Loads all active skills from Postgres.
- If the user selected skills, treats them as the exact required execution set and runs only those skills, up to five total executed skills.
- If the user selected no skills, lets a Manager Planner choose relevant skills from all active skills, up to five total executed skills.
- Gives planner, specialist, manager, fallback, and skill-draft agents all available MCP servers plus WebSearch.
- Runs specialists in parallel.
- Creates a separate OpenAI trace for each `SpecialistSkillAgent-{skill name}` run, linked to the parent `Agentic task` trace through trace metadata.
- Uses a Manager Agent to synthesize one final Markdown answer.
- Falls back to direct manager research when no relevant skills exist, and suggests creating a reusable skill.

The stream emits `trace_started`, `manager_planning_started`, `execution_plan_created`, `skill_selected_by_manager`, `skill_skipped_by_manager`, `no_relevant_skills`, `manager_started`, `specialist_started`, `tool_called`, `tool_output`, `specialist_completed`, `text_delta`, `manager_completed`, `trace_completed`, `error`, and `done`.

Skill drafts can be generated without saving:

```sh
curl http://localhost:8000/api/skills/draft \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a skill for dividend sustainability analysis"}'
```

## Financial Analysis Workflow

The frontend routes financial-analysis prompts to a dedicated backend stream. The backend normalizes the submitted stock input, creates one `FinancialAnalysisAgent` with MCP twstock tools and WebSearch, and lets the OpenAI Agents SDK tool-calling loop decide which tools to call:

```sh
curl -N http://localhost:8000/api/financial-analysis/stream \
  -H "Content-Type: application/json" \
  -d '{"stock":"2330","question":"Analyze valuation and growth for 2330."}'
```

The workflow:

- Frontend infers whether the prompt is a financial workflow.
- Frontend extracts a stock input from the prompt or recent chat history.
- Backend normalizes the submitted stock input.
- Backend preserves the original question and optional recent chat context.
- One analyst agent decides which MCP and WebSearch tools to call.
- Backend streams the analyst agent response.

The stream emits `trace_started`, `agent_started`, `agent_completed`, `reasoning_event`, `tool_called`, `tool_output`, `text_delta`, `trace_completed`, `error`, and `done`.

## Button-Triggered Visualizations

Normal analysis agents do not call `ImageGenerationTool`. After an agentic answer completes, the frontend can show a per-answer **Generate Images** button when that answer has saved required-skill metadata. The button calls a dedicated visualization stream:

```sh
curl -N http://localhost:8000/api/visualizations/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"分析 2330 的估值","answer":"...final markdown...","required_skill_ids":["..."],"stock":"2330"}'
```

The backend loads those required skills and runs a dedicated `SkillVisualizationAgent-{skill name}` with `ImageGenerationTool`, producing exactly one image artifact per required skill. The visualization stream emits `trace_started`, `image_generation_started`, `image_generated`, `trace_completed`, `error`, and `done`.

Chat sessions persist message JSON and event JSON snapshots. The frontend Activity Rail has Chat Sessions and Event Logs tabs; Event Logs are grouped by session, then by round. Deleting a round log removes only that round's events/activity metadata, not the chat messages.

## Run The MCP Server Directly

Install MCP server dependencies:

```sh
cd mcp-arithmetic
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Start the FastMCP server:

```sh
uvicorn server:app --host 0.0.0.0 --port 8080
```

The MCP endpoint is available at:

```text
http://localhost:8080/mcp
```

## Use From Python OpenAI Agents SDK

Install the Python dependencies used by the sample client:

```sh
pip install openai-agents python-dotenv
```

Set your OpenAI API key, start the FastMCP server, then run:

```sh
python openai_agents_client.py
```

To verify MCP connectivity without making an OpenAI API call:

```sh
LIST_TOOLS_ONLY=1 python openai_agents_client.py
```

The sample client uses streamable HTTP:

```python
from agents.mcp import MCPServerStreamableHttp

mcp_server = MCPServerStreamableHttp(
    params={"url": "http://localhost:8080/mcp"},
    name="arithmetic-mcp-fastmcp",
    cache_tools_list=True,
    use_structured_content=True,
)
```

## React Chatbot Event Streaming

The frontend calls `POST /api/chat/stream` on `chat-api`. The backend keeps `OPENAI_API_KEY` server-side, connects to the MCP servers at `MCP_HTTP_URL` and `TWSTOCK_MCP_HTTP_URL`, and streams newline-delimited JSON events:

- `mcp_ready`
- `text_delta`
- `reasoning_delta`
- `reasoning_event`
- `tool_called`
- `tool_output`
- `agent_event`
- `done`
- `error`

Reasoning events are rendered when emitted by the selected model/API. Tool events are shown when the agent calls arithmetic or Taiwan stock MCP tools.

## MCP Client Configuration

Use streamable HTTP:

```json
{
  "mcpServers": {
    "arithmetic-mcp-fastmcp": {
      "url": "http://localhost:8080/mcp"
    },
    "twstock-mcp-fastmcp": {
      "url": "http://localhost:8081/mcp"
    }
  }
}
```

## Notes

Each tool accepts two numeric arguments, `a` and `b`, and returns structured JSON content:

```json
{
  "result": 42
}
```

Division by zero returns a tool-level error, allowing clients or models to recover without treating it as a transport failure.

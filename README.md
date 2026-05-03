# TWStock Agents

Docker Compose app for MCP-backed arithmetic tools, Taiwan stock tools, and skilled financial-analysis agents.

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

## Run With Docker Compose

Create a `.env` file in this folder with your OpenAI API key:

```sh
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
FINANCIAL_ANALYSIS_MODEL="gpt-5-mini"
FINANCIAL_ANALYSIS_WEB_CONTEXT="medium"
ENABLE_FINANCIAL_IMAGE="true"
```

Only `OPENAI_API_KEY` is required. The other variables are optional.

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

The Compose stack starts four services:

- `arithmetic-mcp-fastmcp`: Python FastMCP arithmetic server.
- `twstock-mcp-fastmcp`: Python FastMCP Taiwan stock server powered by `twstock`.
- `chat-api`: Python FastAPI bridge using the OpenAI Agents SDK and the MCP server.
- `chat-web`: React/Vite chatbot UI that streams reasoning, tool, and text events.

## Financial Analysis Agents

The backend exposes a skilled-agent workflow for Traditional Chinese stock analysis:

```sh
curl -N http://localhost:8000/api/financial-analysis/stream \
  -H "Content-Type: application/json" \
  -d '{"stock":"2330"}'
```

Specialists include:

- `CompanyOverviewAgent`
- `FinancialHealthAgent`
- `GrowthMomentumAgent`
- `ValuationStateAgent`
- `CashFlowStructureAgent`
- `PeerComparisonAgent`
- `EntryStrategyAgent`
- `SixWayPEValuationAgent`
- `VisualSummaryAgent`
- `FinancialReportOrchestrator`

The stream emits `agent_started`, `agent_completed`, `source_found`, `tool_called`, `tool_output`, `text_delta`, `image_generated`, `error`, and `done`.

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

# Current Architecture Design

## Purpose

This project currently runs a Docker Compose based MCP chatbot with Python FastMCP MCP servers:

- `chat-web`: React/Vite chatbot frontend.
- `chat-api`: FastAPI backend that uses the Python OpenAI Agents SDK.
- `arithmetic-mcp-fastmcp`: Python FastMCP server exposing arithmetic tools over streamable HTTP.
- `twstock-mcp-fastmcp`: Python FastMCP server exposing Taiwan stock tools powered by `twstock`.

The frontend streams assistant text into the chat bubble while showing reasoning and tool events in a right-side event history panel grouped by chat round.

The backend exposes a financial-analysis workflow with code-owned orchestration, one analyst agent, and one optional visualization agent. FastAPI preserves the user's question and recent context, selects requested analysis sections with deterministic rules, fetches low-cost MCP stock data, then asks `FinancialAnalysisAgent` to interpret the data. If the user asks for a chart/image, `FinancialVisualizationAgent` receives the numerical context and uses `ImageGenerationTool` to create an image shown in chat.

## Key Architecture Decisions

### MCP Servers: Python FastMCP

- Same language family as `chat-api`.
- Faster to extend for future stock-research tools.
- Supports network-based streamable HTTP MCP transport for Docker Compose.
- SSE remains a legacy compatibility option; streamable HTTP is the default.

### Financial Analysis: Code-Owned Planner + One Analyst Agent

- `chat-api` owns request parsing, section dispatch, deterministic data collection, and stream event normalization.
- `FinancialAnalysisAgent` owns interpretation and answer writing.
- `FinancialVisualizationAgent` owns chart/image generation when the request asks for visualization.
- The workflow preserves the original user question instead of converting every request into a fixed full-report prompt.
- The backend selects sections such as `valuation`, `growth`, `technical`, `peers`, or `cashflow` using explicit regex rules in `financial_agents/orchestrator.py`.
- The backend calls MCP tools directly for common structured data before invoking the model.
- This replaces the previous many-specialist A2A manager model and avoids fragile tool-output-to-agent attribution.

Benefits over the previous many-agent architecture:
- Lower latency and cost from fewer model calls.
- Easier debugging because routing and data collection are visible Python code.
- Selective prompts are deterministic.
- Prompt ownership is simpler because only one runtime analyst prompt is active.

## System Diagram

```mermaid
flowchart LR
    user[User Browser]

    subgraph compose[Docker Compose Project]
        web[chat-web<br/>React + Vite<br/>Port 5173]
        api[chat-api<br/>FastAPI + OpenAI Agents SDK<br/>Port 8000]
        arithmetic[arithmetic-mcp-fastmcp<br/>Python FastMCP Arithmetic Server<br/>Port 8080]
        twstock[twstock-mcp-fastmcp<br/>Python FastMCP twstock Server<br/>Port 8081]
    end

    openai[OpenAI API]

    user -->|Open app| web
    web -->|POST /api/chat/stream<br/>chat NDJSON stream| api
    web -->|POST /api/financial-analysis/stream<br/>financial NDJSON stream| api
    api -->|MCP streamable HTTP<br/>/mcp| arithmetic
    api -->|MCP streamable HTTP<br/>/mcp| twstock
    api -->|FinancialAnalysisAgent + optional<br/>FinancialVisualizationAgent| openai
    api -->|Model request + streaming events| openai
    openai -->|Text, reasoning, tool orchestration events| api
    arithmetic -->|Tool results<br/>addition/subtraction/multiplication/divide| api
    twstock -->|Taiwan stock metadata, quotes,<br/>historical data, moving averages, signals| api
    api -->|text_delta, reasoning_event,<br/>tool_called, tool_output,<br/>agent_started, error| web
    web -->|Assistant bubble + event panel| user
```

## Financial Analysis Architecture

```mermaid
flowchart TB
    request[POST /api/financial-analysis/stream<br/>stock + question]
    parser[Request parser<br/>normalize stock + infer sections]
    collector[Data collector<br/>direct MCP tool calls]
    analyst[FinancialAnalysisAgent<br/>single OpenAI agent]
    visual[FinancialVisualizationAgent<br/>ImageGenerationTool]

    websearch[OpenAI WebSearchTool]
    imagegen[OpenAI ImageGenerationTool]
    mcp[twstock MCP tools]
    final[Financial analysis response]
    image[Generated chart image]

    request --> parser
    parser --> collector
    collector --> mcp
    collector --> analyst
    parser --> analyst
    analyst --> websearch
    analyst --> mcp
    analyst --> final
    collector --> visual
    parser --> visual
    visual --> imagegen
    visual --> image
```

### Financial Flow Detail

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant C as Data Collector
    participant F as FinancialAnalysisAgent
    participant V as FinancialVisualizationAgent
    participant O as OpenAI API
    participant T as twstock-mcp-fastmcp

    U->>W: Request financial analysis for 2330
    W->>A: POST /api/financial-analysis/stream with stock + question
    A->>A: Normalize stock and infer requested sections
    A->>C: Collect structured data for the plan
    C->>T: get_stock_info / quote / history / MA as needed
    T-->>C: Structured MCP data
    C-->>A: collected_data
    A->>F: Create one analyst agent with prompt templates
    F->>O: Interpret question + plan + collected data
    O-->>F: Stream response and tool events
    F-->>A: text_delta / reasoning / tool events
    opt User asked for chart/image
        A->>V: Send question + recent context + numerical data
        V->>O: Generate image with ImageGenerationTool
        O-->>V: image_generation_call result
        V-->>A: image_generated event
    end
    A-->>W: NDJSON stream
    W-->>U: Render answer + event history
```

## Request And Event Flow (Chat)

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant W as chat-web
    participant A as chat-api
    participant O as OpenAI API
    participant M as arithmetic-mcp-fastmcp
    participant T as twstock-mcp-fastmcp

    U->>W: Submit arithmetic chat message
    W->>A: POST /api/chat/stream
    A->>M: Connect MCPServerStreamableHttp to /mcp
    M-->>A: Tool list ready
    A->>T: Connect MCPServerStreamableHttp to /mcp
    T-->>A: Tool list ready
    A-->>W: mcp_ready
    A->>O: Run Arithmetic MCP Chat Agent
    O-->>A: text_delta / reasoning events
    A-->>W: Stream normalized NDJSON events
    O->>A: Request arithmetic tool call
    A-->>W: tool_called
    A->>M: Invoke FastMCP arithmetic tool
    M-->>A: Structured result
    O->>A: Request Taiwan stock tool call
    A-->>W: tool_called
    A->>T: Invoke FastMCP twstock tool
    T-->>A: Structured stock result
    A-->>W: tool_output
    O-->>A: Final assistant text
    A-->>W: text_delta, done
    W-->>U: Render assistant response and grouped event history
```

## Runtime Services

| Service | Container | Port | Responsibility |
| --- | --- | --- | --- |
| `chat-web` | `arithmetic-mcp-chat-web` | `5173` | Browser UI for chat, streaming assistant text, and round-grouped event history. |
| `chat-api` | `arithmetic-mcp-chat-api` | `8000` | Keeps `OPENAI_API_KEY` server-side, converts chat rounds into an agent prompt, streams normalized events to the frontend. |
| `arithmetic-mcp-fastmcp` | `arithmetic-mcp-fastmcp` | `8080` | Python FastMCP server exposing `addition`, `subtraction`, `multiplication`, and `divide`. |
| `twstock-mcp-fastmcp` | `twstock-mcp-fastmcp` | `8081` | Python FastMCP server exposing Taiwan stock metadata, realtime quote, historical OHLC, moving average, and Best Four Point tools. |

## Important Endpoints

| Endpoint | Owner | Use |
| --- | --- | --- |
| `GET /` | `chat-web` | Serves the React application. |
| `GET /api/health` | `chat-api` | Backend health check. |
| `GET /api/mcp/tools` | `chat-api` | Lists tools discovered from both configured MCP servers. |
| `POST /api/chat/stream` | `chat-api` | Main chatbot endpoint; returns newline-delimited JSON events. |
| `POST /api/financial-analysis/stream` | `chat-api` | Parses `stock`, optional `question`, and optional recent `context`; collects relevant MCP data; runs `FinancialAnalysisAgent`; optionally runs `FinancialVisualizationAgent`; and streams normalized NDJSON events. |
| `GET /healthz` | `arithmetic-mcp-fastmcp` | MCP server health check exposed by the container app. |
| `/mcp` | `arithmetic-mcp-fastmcp` | FastMCP streamable HTTP transport endpoint. |
| `GET /healthz` | `twstock-mcp-fastmcp` | Taiwan stock MCP server health check. |
| `/mcp` | `twstock-mcp-fastmcp` | FastMCP streamable HTTP transport endpoint for Taiwan stock tools. |
| `/sse` | `arithmetic-mcp-fastmcp` | Optional legacy SSE transport only if compatibility is required. |

## FastMCP Server Shape

The arithmetic MCP service should be implemented as a Python FastMCP server with an identifiable server name:

```python
from fastmcp import FastMCP

mcp = FastMCP("arithmetic-mcp-fastmcp")


@mcp.tool
def addition(a: float, b: float) -> dict[str, float]:
    return {"result": a + b}


@mcp.tool
def subtraction(a: float, b: float) -> dict[str, float]:
    return {"result": a - b}


@mcp.tool
def multiplication(a: float, b: float) -> dict[str, float]:
    return {"result": a * b}


@mcp.tool
def divide(a: float, b: float) -> dict[str, float]:
    if b == 0:
        raise ValueError("division by zero")
    return {"result": a / b}


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=8080)
```

The MCP endpoint should remain:

```text
http://arithmetic-mcp-fastmcp:8080/mcp
```

`chat-api` can continue to use the OpenAI Agents SDK `MCPServerStreamableHttp` client against that endpoint.

## twstock MCP Tools

The `twstock-mcp-fastmcp` service wraps the public `twstock` Python package.

| Tool | Purpose |
| --- | --- |
| `get_stock_info(stock_id)` | Read stock metadata from `twstock.codes`. |
| `get_realtime_quote(stock_id)` | Fetch realtime quote data for one Taiwan stock. |
| `get_realtime_quotes(stock_ids)` | Fetch realtime quote data for multiple Taiwan stocks. |
| `get_historical_data(stock_id, year, month)` | Fetch historical OHLC trading data. If year/month are omitted, returns recent trading days. |
| `calculate_moving_average(stock_id, days)` | Calculate a moving average from recent closing prices. |
| `analyze_best_four_point(stock_id)` | Run `twstock.BestFourPoint` buy/sell/neutral technical signal logic. |

`twstock` uses TWSE/TPEX data sources. Realtime or historical calls may fail or return no data when upstream data is unavailable, rate limited, or queried outside market/data availability windows.

## Event Contract

`chat-api` emits one JSON object per line from both `POST /api/chat/stream` and `POST /api/financial-analysis/stream`.

The frontend renders these events:

- `text_delta`: appended directly to the active assistant message bubble.
- `reasoning_delta`: shown in the right event history panel.
- `reasoning_event`: shown in the right event history panel.
- `tool_called`: shown in the right event history panel.
- `tool_output`: shown in the right event history panel.
- `error`: shown in the right event history panel and surfaced in the assistant message when stream-level failures occur.

The frontend intentionally ignores these events in the event history:

- `mcp_ready`
- `done`
- generic `agent_event`

Financial-analysis streams additionally emit:

- `agent_started`: emitted for the code-owned financial orchestrator and the single `FinancialAnalysisAgent`.
- `agent_started`: also emitted for `FinancialVisualizationAgent` when an image/chart is requested.
- `agent_completed`: emitted when the financial analysis or visualization agent finishes.
- `tool_called`: emitted both for deterministic backend MCP collection and model-requested tools.
- `tool_output`: emitted for deterministic backend MCP results and model-requested tool outputs.
- `image_generated`: emitted with `image.b64_json` and `image.image_url` when `FinancialVisualizationAgent` generates a chart.

## Financial Analysis Request Handling

The frontend chooses the financial endpoint when a prompt matches financial keywords such as `財務`, `合理價`, `本益比`, `估值`, `同業`, `現金流`, `分批`, or `完整分析`.

For financial requests, the frontend sends:

```json
{
  "stock": "2330",
  "question": "請為股票 2330 台積電產生完整的財務分析報告...",
  "context": "Recent visible chat transcript, used for follow-up chart requests."
}
```

The backend request model accepts both fields and passes both into `run_financial_analysis()`. The orchestrator:

- Normalizes the stock input.
- Preserves the original question.
- Infers requested sections with explicit regex rules.
- Collects relevant MCP data before calling the model.
- Renders the final model prompt from `financial_agents/prompts/financial_analysis_input.md`.

## Prompt Management

Financial prompts are stored as versioned markdown templates under `backend/financial_agents/prompts/` and loaded through `financial_agents/prompt_store.py`.

| Prompt key | File | Runtime use |
| --- | --- | --- |
| `financial_analysis.instructions` | `financial_analysis_instructions.md` | System instructions for `FinancialAnalysisAgent`. |
| `financial_analysis.input` | `financial_analysis_input.md` | Backend-rendered model input containing question, stock, selected sections, and collected data. |
| `financial_visualization.instructions` | `financial_visualization_instructions.md` | System instructions for `FinancialVisualizationAgent`. |
| `financial_visualization.input` | `financial_visualization_input.md` | Backend-rendered image prompt containing question, recent context, and numerical data. |
| `manager_dispatch.instructions` | `manager_dispatch_instructions.md` | Governance document for dispatch policy and future LLM planner work; current dispatch is Python code. |

Prompt management rules:

- Keep long instruction text out of Python modules.
- Use stable prompt keys and explicit `PromptSpec.version` values.
- Treat Python dispatch rules as the source of truth for current routing.
- Use markdown prompt files for reviewable changes.
- Override a prompt file path with `FINANCIAL_PROMPT_<PROMPT_KEY>` environment variables when testing variants, for example `FINANCIAL_PROMPT_FINANCIAL_ANALYSIS_INSTRUCTIONS=/path/to/prompt.md`.

## Chat Round Memory

The browser sends the visible chat transcript to `chat-api`.

`chat-api` converts that transcript into numbered chat rounds:

- A round starts with a user message.
- A completed round includes the assistant final response.
- The current user message is sent separately as the current request.

The agent instruction tells the model to treat previous assistant final responses as memory. For cumulative arithmetic questions, the backend prompt asks the model to use prior final answers rather than intermediate values from previous explanations.

## Frontend Layout

The React app uses a two-column desktop layout:

- Left column: chatbot messages and composer.
- Right column: persistent event history panel.

On narrower screens, the layout stacks vertically. The event panel uses internal scroll areas and bounded code blocks so long tool payloads do not resize or break the page.

## Configuration

Docker Compose reads `.env` from the project root for backend secrets and model configuration:

```sh
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
```

`OPENAI_MODEL` is optional. If it is omitted, Compose uses `gpt-5-mini`.

Financial-analysis options:

```sh
FINANCIAL_ANALYSIS_MODEL="gpt-5-mini"
FINANCIAL_ANALYSIS_WEB_CONTEXT="medium"
OPENAI_IMAGE_MODEL="gpt-image-1"
OPENAI_IMAGE_QUALITY="low"
```

`chat-api` connects to the FastMCP servers inside the Compose network with:

```sh
MCP_HTTP_URL=http://arithmetic-mcp-fastmcp:8080/mcp
TWSTOCK_MCP_HTTP_URL=http://twstock-mcp-fastmcp:8081/mcp
```

## Docker Compose Shape

The Compose stack has four services:

```yaml
services:
  arithmetic-mcp-fastmcp:
    build:
      context: ./mcp-arithmetic
    image: arithmetic-mcp-fastmcp:latest
    container_name: arithmetic-mcp-fastmcp
    ports:
      - "8080:8080"
    environment:
      PORT: "8080"

  chat-api:
    build:
      context: ./backend
    image: arithmetic-mcp-chat-api:latest
    container_name: arithmetic-mcp-chat-api
    depends_on:
      - arithmetic-mcp-fastmcp
      - twstock-mcp-fastmcp
    env_file:
      - .env
    ports:
      - "8000:8000"
    environment:
      OPENAI_MODEL: ${OPENAI_MODEL:-gpt-5-mini}
      FINANCIAL_ANALYSIS_MODEL: ${FINANCIAL_ANALYSIS_MODEL:-gpt-5-mini}
      FINANCIAL_ANALYSIS_WEB_CONTEXT: ${FINANCIAL_ANALYSIS_WEB_CONTEXT:-medium}
      OPENAI_IMAGE_MODEL: ${OPENAI_IMAGE_MODEL:-gpt-image-1}
      OPENAI_IMAGE_QUALITY: ${OPENAI_IMAGE_QUALITY:-low}
      MCP_HTTP_URL: http://arithmetic-mcp-fastmcp:8080/mcp
      TWSTOCK_MCP_HTTP_URL: http://twstock-mcp-fastmcp:8081/mcp
      CORS_ALLOW_ORIGINS: "*"

  twstock-mcp-fastmcp:
    build:
      context: ./mcp-twstock
    image: twstock-mcp-fastmcp:latest
    container_name: twstock-mcp-fastmcp
    ports:
      - "8081:8081"
    environment:
      PORT: "8081"

  chat-web:
    build:
      context: ./frontend
    image: arithmetic-mcp-chat-web:latest
    container_name: arithmetic-mcp-chat-web
    depends_on:
      - chat-api
    ports:
      - "5173:5173"
```

## Start And Verify

Start the full stack:

```sh
docker compose up --build -d
```

Verify the services:

```sh
curl -i http://localhost:5173
curl -i http://localhost:8000/api/health
curl -i http://localhost:8080/healthz
curl -i http://localhost:8081/healthz
```

Open the app:

```text
http://localhost:5173
```

## Ownership Notes

MCP runtime ownership is now Python FastMCP:

- `arithmetic-mcp-fastmcp` is the MCP service in Compose.
- `twstock-mcp-fastmcp` is the Taiwan stock MCP service in Compose.
- `./mcp-arithmetic` owns arithmetic tool implementation.
- `./mcp-twstock` owns Taiwan stock tool implementation.
- `chat-api` owns request parsing, MCP data collection, prompt rendering, and OpenAI Agents SDK execution.
- `chat-web` remains the streaming chat and event-history UI.
- Prefer streamable HTTP at `/mcp` for new MCP clients.
- Only add SSE if a legacy MCP client requires it.

## References

- FastMCP HTTP transport is recommended for network deployments and exposes the MCP endpoint at `/mcp/`.
- FastMCP SSE transport is legacy compatibility and should not be the default for new services.

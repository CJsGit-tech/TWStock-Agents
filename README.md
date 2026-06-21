# TWStock Agents

Multi-container local stack for a React frontend, a FastAPI backend, and several MCP sidecars. The backend now accepts request-scoped MCP server configuration, validates it, resolves first-party catalog servers or dynamic endpoints, and passes only normalized runtime clients into the chat agent.

## Services

- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/api/health`
- MCP catalog: `GET http://localhost:8000/api/mcp/catalog`
- MCP validation: `POST http://localhost:8000/api/mcp/validate`
- Chat stream: `POST http://localhost:8000/api/chatbot/stream`
- Arithmetic MCP: `http://localhost:8080/mcp`
- TWStock MCP: `http://localhost:8081/mcp`
- Portfolio MCP: `http://localhost:8082/mcp`
- Company MCP: `http://localhost:8083/mcp`

## Architecture Docs

- The architecture docs below are the current source of truth for service topology and MCP orchestration.
- [Container topology](docs/architecture/containers.md)
- [Backend MCP runtime](docs/architecture/backend-mcp-runtime.md)
- [MCP server usage and connection guide](docs/MCP_SERVERS.md)
- [Backend API examples](docs/API_EXAMPLES.md)
- [Portfolio API examples](docs/portfolio-backend/API_EXAMPLES.md)

## Run With Docker Compose

Create `.env` in the repo root:

```sh
OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5-mini"
CHAT_MODEL="gpt-5-mini"
DATABASE_URL="postgresql+psycopg://twstock:twstock@postgres:5432/twstock_agents"
VITE_API_BASE_URL="http://localhost:8000"
```

Only `OPENAI_API_KEY` is required for chat requests that do not supply their own `Authorization` header.

Start the full stack:

```sh
docker compose up --build
```

Start detached:

```sh
docker compose up -d --build
```

Follow logs:

```sh
docker compose logs -f chat-api chat-web
```

Stop:

```sh
docker compose down
```

Reset volumes:

```sh
docker compose down -v
```

## Compose Layout

The root `docker-compose.yml` manages:

- `postgres`
- `chat-api`
- `chat-web`
- `arithmetic-mcp-fastmcp`
- `twstock-mcp-fastmcp`
- `portfolio-mcp-fastmcp`
- `company-mcp-fastmcp`

MCP sidecars share a uniform Compose pattern so future services can be added with a small service block and one backend catalog entry.

## Backend MCP Model

The backend exposes a first-party MCP catalog and a request-level validation path:

- `GET /api/mcp/catalog` lists built-in servers such as `portfolio`, `company`, `twstock`, and `arithmetic`
- `POST /api/mcp/validate` validates a proposed `mcp.servers[]` block before a chat request
- `POST /api/chatbot/stream` accepts `messages`, optional `session_id`, and optional multi-server `mcp`

Example request:

```json
{
  "messages": [
    { "role": "user", "content": "Compare my portfolio against Taiwan AI names." }
  ],
  "mcp": {
    "servers": [
      {
        "id": "portfolio",
        "tool_mode": "allow_list",
        "allowed_tools": ["list_portfolios", "get_portfolio"]
      },
      {
        "id": "company",
        "tool_mode": "allow_list",
        "allowed_tools": ["get_company_by_ticker", "list_company_relations"]
      },
      { "id": "twstock" },
      {
        "name": "custom-news",
        "transport": "streamable_http",
        "url": "http://news-mcp.internal:8090/mcp"
      }
    ]
  }
}
```

## Add A New First-Party MCP Server

1. Create `mcp-<domain>/` with a `Dockerfile`, dependencies, `/mcp`, and `/healthz`.
2. Add a new Compose service based on the existing MCP sidecar pattern.
3. Add one catalog entry in `backend/mcp_runtime/catalog.py`.
4. Rebuild with `docker compose up --build`.

For concrete usage examples and direct connection URLs, see [docs/MCP_SERVERS.md](docs/MCP_SERVERS.md).

## Verification

Backend tests:

```sh
python -m unittest discover backend/tests -v
```

Useful manual checks:

```sh
curl http://localhost:8000/api/health
curl http://localhost:8000/api/mcp/catalog
curl -X POST http://localhost:8000/api/mcp/validate \
  -H "Content-Type: application/json" \
  -d '{"servers":[{"id":"portfolio"}]}'
```

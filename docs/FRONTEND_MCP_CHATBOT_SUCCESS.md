# Frontend MCP Chatbot Completion Notes

## Goal

Build a React chatbot interface that can stream LLM output while surfacing reasoning events, MCP tool calls, and MCP tool outputs. The app runs with Docker Compose alongside the Python FastMCP arithmetic server.

## Architecture

- `arithmetic-mcp-fastmcp`: Python FastMCP server exposing arithmetic tools over streamable HTTP.
- `twstock-mcp-fastmcp`: Python FastMCP server exposing Taiwan stock tools powered by `twstock`.
- `chat-api`: FastAPI bridge that keeps `OPENAI_API_KEY` server-side, connects to both FastMCP servers with OpenAI Agents SDK `MCPServerStreamableHttp`, and streams normalized NDJSON events to the browser.
- `chat-web`: React/Vite frontend that renders chat messages, saved sessions, session-grouped event logs, reasoning/tool events, image galleries, and streaming text responses.
- Financial analysis workflow: `FinancialAnalysisAgent` with MCP twstock tools + `WebSearchTool` (the agent owns all tool-calling decisions via the SDK).
- Dynamic skills workflow: user-created skills are stored in Postgres. If users select skills, exactly those skills run; if no skills are selected, the Manager Planner chooses relevant active skills. The Manager Agent synthesizes the final output through `POST /api/agentic-task/stream`.
- Explicit visualization workflow: completed agentic answers with saved required-skill metadata can call `POST /api/visualizations/stream`; the backend runs one dedicated `SkillVisualizationAgent-{skill name}` with `ImageGenerationTool` per required skill.

## Guided Starter Experience

The frontend includes an inline first-run guide and guided starter examples:

- Arithmetic examples for MCP calculator tools.
- Taiwan stock examples for `twstock-mcp-fastmcp`, including stock metadata, realtime quote, Best Four Point signal, and moving average prompts.
- Financial-analysis examples for focused or broader Taiwan stock questions.
- Skill workbench for creating, editing, deleting, and marking up to five required specialist skills for agentic tasks.
- Starter example clicks submit the first question immediately.
- After the first response finishes, the app shows a second pre-built question for that example flow.
- The second question requires a user click and is submitted through the same streaming chat path.
- After the second response finishes, the app shows an example-complete state and lets the user start another example.
- The inline guide uses `Back`, `Next`, and `Done` controls.
- Guide dismissal is persisted in browser `localStorage` as `mcpChatTutorialDismissed=true`.
- The `Guide` button in the top bar reopens the guided starter experience.
- Tool calls, tool outputs, and reasoning events are grouped by saved chat session and assistant round in the left Activity Rail's Event Logs tab.
- Chat sessions persist message JSON and event JSON snapshots in Postgres; round-log deletion removes event/activity metadata without deleting chat messages.
- Financial-agent starter prompts route to `POST /api/financial-analysis/stream`.
- Required-skill or manager-auto-pick prompts route to `POST /api/agentic-task/stream`.
- Skill drafts are generated through `POST /api/skills/draft`, populate the editor, and are not saved until the user confirms.

## Event Contract

The backend emits one JSON object per line:

- `mcp_ready`: MCP server connected and tools listed.
- `text_delta`: streamed assistant text.
- `reasoning_delta`: streamed model reasoning text or summary deltas when emitted by the model/API.
- `reasoning_event`: non-delta reasoning event metadata.
- `tool_called`: an MCP/tool call was requested.
- `tool_output`: the tool returned output.
- `agent_event`: other Agents SDK run-item events.
- `agent_started`: the financial orchestrator or analyst agent started.
- `agent_completed`: the analyst agent completed.
- `manager_planning_started`: the backend is preparing the skill execution set. With selected skills, it uses exactly those skills; with no selected skills, the Manager Planner chooses relevant skills.
- `execution_plan_created`: the planned execution set is ready.
- `skill_selected_by_manager`: an optional skill was added.
- `skill_skipped_by_manager`: an active skill was skipped.
- `no_relevant_skills`: no active skill matched; direct manager research is used.
- `manager_started`: the dynamic manager workflow started.
- `manager_completed`: the final manager synthesis completed.
- `specialist_started`: a required or manager-selected skill agent started.
- `specialist_completed`: a required or manager-selected skill agent completed.
- `image_generation_started`: the explicit skill visualization workflow started a visual artifact.
- `image_generated`: the explicit skill visualization workflow generated an image artifact.
- `done`: stream finished.
- `error`: backend or upstream error.

## Success Criteria

- Docker Compose starts MCP, API, and web services.
- `chat-api` reads `OPENAI_API_KEY` from the project `.env` file by default.
- Browser UI is available at `http://localhost:5173`.
- API health is available at `http://localhost:8000/api/health`.
- MCP health remains available at `http://localhost:8080/healthz`.
- twstock MCP health is available at `http://localhost:8081/healthz`.
- Chat stream processes independent reasoning, tool, and text events.
- Financial-analysis stream processes analyst agent events and tool events.
- Agentic task stream processes manager events, specialist events, tool events, and final synthesized text.
- Visualization stream processes per-required-skill image generation events and appends the resulting gallery to the source assistant answer.
- First-run users can start from guided example cards or the inline guide.
- Guided example cards auto-submit the selected prompt.
- The next suggested question appears only after the first guided response completes.
- `OPENAI_API_KEY` never appears in frontend code.

## Verification Commands

```sh
python -m py_compile backend/app.py openai_agents_client.py mcp-arithmetic/server.py mcp-twstock/server.py
python -m unittest discover backend/tests
cd frontend && npm run build
docker compose up --build
```

## Notes

Reasoning deltas depend on the selected model and API behavior. The frontend supports them when emitted, but some models or requests may only emit text and tool events.

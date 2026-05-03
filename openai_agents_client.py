import asyncio
import os
from contextlib import AsyncExitStack

from dotenv import load_dotenv

from agents import Agent, Runner
from agents.mcp import MCPServerStreamableHttp


load_dotenv()

ARITHMETIC_MCP_SERVER_NAME = "arithmetic-mcp-fastmcp"
TWSTOCK_MCP_SERVER_NAME = "twstock-mcp-fastmcp"


def build_mcp_servers():
    return [
        MCPServerStreamableHttp(
            params={"url": os.getenv("MCP_HTTP_URL", "http://localhost:8080/mcp")},
            name=ARITHMETIC_MCP_SERVER_NAME,
            cache_tools_list=True,
            use_structured_content=True,
        ),
        MCPServerStreamableHttp(
            params={"url": os.getenv("TWSTOCK_MCP_HTTP_URL", "http://localhost:8081/mcp")},
            name=TWSTOCK_MCP_SERVER_NAME,
            cache_tools_list=True,
            use_structured_content=True,
        ),
    ]


async def main():
    async with AsyncExitStack() as stack:
        mcp_servers = [await stack.enter_async_context(server) for server in build_mcp_servers()]
        for server in mcp_servers:
            tools = await server.list_tools()
            print(f"{server.name} tools:", ", ".join(tool.name for tool in tools))

        if os.getenv("LIST_TOOLS_ONLY") == "1":
            return

        agent = Agent(
            name="Arithmetic and Taiwan Stock Agent",
            instructions=(
                "Use arithmetic MCP tools for calculations. Use twstock MCP tools for Taiwan stock "
                "metadata, realtime quotes, historical prices, moving averages, and technical signals."
            ),
            model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
            mcp_servers=mcp_servers,
        )

        result = await Runner.run(
            agent,
            "Use the MCP tools to calculate (18 + 24) * 3, then divide the result by 7.",
        )
        print(result.final_output)


if __name__ == "__main__":
    asyncio.run(main())

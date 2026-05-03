import os

from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Mount, Route


MCP_SERVER_NAME = "arithmetic-mcp-fastmcp"

mcp = FastMCP(
    MCP_SERVER_NAME,
    instructions="Arithmetic MCP server exposing addition, subtraction, multiplication, and division tools.",
)


@mcp.tool
def addition(a: float, b: float) -> dict[str, float]:
    """Add two numbers."""
    return {"result": a + b}


@mcp.tool
def subtraction(a: float, b: float) -> dict[str, float]:
    """Subtract b from a."""
    return {"result": a - b}


@mcp.tool
def multiplication(a: float, b: float) -> dict[str, float]:
    """Multiply two numbers."""
    return {"result": a * b}


@mcp.tool
def divide(a: float, b: float) -> dict[str, float]:
    """Divide a by b."""
    if b == 0:
        raise ValueError("division by zero")
    return {"result": a / b}


async def healthz(_request) -> PlainTextResponse:
    return PlainTextResponse("ok")


mcp_app = mcp.http_app(path="/mcp", transport="http")
app = Starlette(
    routes=[
        Route("/healthz", healthz, methods=["GET"]),
        Mount("/", app=mcp_app),
    ],
    lifespan=mcp_app.lifespan,
)


if __name__ == "__main__":
    mcp.run(transport="http", host="0.0.0.0", port=int(os.getenv("PORT", "8080")))

import os

from agents import Agent, ImageGenerationTool, WebSearchTool
from agents.mcp import MCPServer

from .prompt_store import render_prompt


def financial_model() -> str:
    return os.getenv("FINANCIAL_ANALYSIS_MODEL", os.getenv("OPENAI_MODEL", "gpt-5-mini"))


def web_context_size() -> str:
    value = os.getenv("FINANCIAL_ANALYSIS_WEB_CONTEXT", "medium").lower()
    return value if value in {"low", "medium", "high"} else "medium"


def web_search_tool() -> WebSearchTool:
    return WebSearchTool(search_context_size=web_context_size())  # type: ignore[arg-type]


def financial_analysis_agent(mcp_servers: list[MCPServer]) -> Agent:
    """Single analyst agent for the financial workflow.

    Backend code owns request parsing, deterministic data collection, and
    event emission. The model owns interpretation and explanation.
    """

    return Agent(
        name="FinancialAnalysisAgent",
        instructions=render_prompt("financial_analysis.instructions"),
        model=financial_model(),
        tools=[web_search_tool()],
        mcp_servers=mcp_servers,
    )


def image_model() -> str:
    return os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")


def financial_visualization_agent() -> Agent:
    """Specialized image-generation agent for financial visualizations."""

    return Agent(
        name="FinancialVisualizationAgent",
        instructions=render_prompt("financial_visualization.instructions"),
        model=financial_model(),
        tools=[
            ImageGenerationTool(
                tool_config={
                    "type": "image_generation",
                    "model": image_model(),
                    "size": "1024x1024",
                    "quality": os.getenv("OPENAI_IMAGE_QUALITY", "low"),
                }
            )
        ],
    )

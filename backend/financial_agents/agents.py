import os

from agents import Agent, ImageGenerationTool, ModelSettings, WebSearchTool
from agents.mcp import MCPServer

from .schemas import DISCLAIMER


def financial_model() -> str:
    return os.getenv("FINANCIAL_ANALYSIS_MODEL", os.getenv("OPENAI_MODEL", "gpt-5-mini"))


def _model_settings() -> ModelSettings:
    """Shared model settings.

    Only gpt-5* and o* models support the reasoning parameter.
    gpt-4.1 and image models do not — sending it causes an API error.
    """
    model = financial_model()
    if model.startswith(("gpt-5", "o3", "o4")):
        return ModelSettings(reasoning={"effort": "low"})
    return ModelSettings()


def web_context_size() -> str:
    value = os.getenv("FINANCIAL_ANALYSIS_WEB_CONTEXT", "medium").lower()
    return value if value in {"low", "medium", "high"} else "medium"


def web_search_tool() -> WebSearchTool:
    return WebSearchTool(search_context_size=web_context_size())  # type: ignore[arg-type]


def image_model() -> str:
    return os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")


def financial_analysis_agent(mcp_servers: list[MCPServer]) -> Agent:
    """Single financial analyst agent.

    Has access to MCP stock tools (via the SDK's native tool-calling loop)
    and WebSearch.  The model decides which tools to call and when.
    """
    return Agent(
        name="FinancialAnalysisAgent",
        instructions=(
            "你是台灣股票財務分析師。使用者會問你關於台灣股票的問題。\n\n"
            "## 你的工具\n"
            "- **MCP twstock 工具**：get_stock_info、get_realtime_quote、get_realtime_quotes、"
            "get_historical_data、calculate_moving_average、analyze_best_four_point。"
            "用這些工具取得股票基本資料、即時報價、歷史數據、均線與技術訊號。\n"
            "- **WebSearch**：用來查詢最新的財報數據、新聞、產業資訊等公開資料。\n\n"
            "## 工作原則\n"
            "- 根據使用者的問題決定需要呼叫哪些工具，不需要每次都全部呼叫。\n"
            "- 如果使用者要求完整分析，依序收集公司概要、財務體質、成長動能、估值、"
            "現金流、同業比較、合理價估算、買進策略等資料。\n"
            "- 如果使用者只問特定面向（例如只問估值），只查詢相關資料。\n"
            "- 工具回傳的數據可能因為非交易時間、限流等原因而不可用，遇到時說明即可。\n"
            "- 缺少資料時明確說明，不要編造精確數字。\n"
            "- 使用繁體中文回答。\n"
            "- 引用資料來源。\n"
            f"- 涉及投資建議時，以分析情境與假設呈現，最後加入：「{DISCLAIMER}」\n"
        ),
        model=financial_model(),
        model_settings=_model_settings(),
        tools=[web_search_tool()],
        mcp_servers=mcp_servers,
    )


def financial_visualization_agent() -> Agent:
    """Generates chart images from financial data provided in the prompt.

    No system instructions — the user prompt contains all the data and
    the chart request.  The model + ImageGenerationTool handle the rest.
    """
    return Agent(
        name="FinancialVisualizationAgent",
        instructions="Generate a financial chart image based on the user's request and data.",
        model=financial_model(),
        tools=[
            ImageGenerationTool(
                tool_config={
                    "type": "image_generation",
                    "model": image_model(),
                    "size": "1024x1024",
                    "quality": os.getenv("OPENAI_IMAGE_QUALITY", "medium"),
                }
            )
        ],
    )

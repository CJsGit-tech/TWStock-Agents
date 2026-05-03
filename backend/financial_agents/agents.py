import os

from agents import Agent, ImageGenerationTool, WebSearchTool
from agents.mcp import MCPServer

from .schemas import SpecialistResult


def financial_model() -> str:
    return os.getenv("FINANCIAL_ANALYSIS_MODEL", os.getenv("OPENAI_MODEL", "gpt-5-mini"))


def web_context_size() -> str:
    value = os.getenv("FINANCIAL_ANALYSIS_WEB_CONTEXT", "medium").lower()
    return value if value in {"low", "medium", "high"} else "medium"


def web_search_tool() -> WebSearchTool:
    return WebSearchTool(search_context_size=web_context_size())  # type: ignore[arg-type]


def specialist_agent(
    name: str,
    instructions: str,
    *,
    use_web: bool = True,
    mcp_servers: list[MCPServer] | None = None,
) -> Agent:
    tools = [web_search_tool()] if use_web else []
    return Agent(
        name=name,
        instructions=instructions,
        model=financial_model(),
        tools=tools,
        mcp_servers=mcp_servers or [],
        output_type=SpecialistResult,
    )


def company_overview_agent(mcp_servers: list[MCPServer]) -> Agent:
    return specialist_agent(
        "CompanyOverviewAgent",
        (
            "你是公司基本面研究員。只負責輸出公司基本概要：公司名稱、股票代碼、定位、"
            "主要產品/技術/商業模式、客戶產業與主要客戶、是否屬於半導體/AI/電動車/"
            "國防/台積電供應鏈。使用繁體中文。若查不到，明確寫「公開資訊未揭露」。"
            "請附資料來源 URL。"
        ),
        mcp_servers=mcp_servers,
    )


def financial_health_agent() -> Agent:
    return specialist_agent(
        "FinancialHealthAgent",
        (
            "你是財務體質分析師。只負責近4季EPS、毛利率、營業利益率、稅後淨利率、ROE，"
            "並依標準 EPS>=1、毛利率>=20%、營益率>=10%、淨利率>=5%、ROE>=10% 判斷達標。"
            "輸出資料、表格列、假設與來源。使用繁體中文。"
        ),
    )


def growth_momentum_agent() -> Agent:
    return specialist_agent(
        "GrowthMomentumAgent",
        (
            "你是成長動能分析師。只負責近6個月月營收 YoY/MoM 趨勢、EPS 成長或衰退、"
            "以及景氣循環上升/下行判斷。資料不足時提出合理假設並標示。使用繁體中文並附來源。"
        ),
    )


def valuation_state_agent(mcp_servers: list[MCPServer]) -> Agent:
    return specialist_agent(
        "ValuationStateAgent",
        (
            "你是估值狀態分析師。只負責 PE、PB、目前股價是否便宜/合理/偏貴、"
            "是否位於本益比河流圖或股價淨值比河流圖藍色區間。若沒有河流圖資料，"
            "請用歷史區間推估並註明假設。使用繁體中文並附來源。"
        ),
        mcp_servers=mcp_servers,
    )


def cashflow_structure_agent() -> Agent:
    return specialist_agent(
        "CashFlowStructureAgent",
        (
            "你是現金流與財務結構分析師。只負責營業現金流 vs 淨利、自由現金流、"
            "負債比率、是否借錢配息、庫存是否異常增加。使用繁體中文並附來源。"
        ),
    )


def peer_comparison_agent() -> Agent:
    return specialist_agent(
        "PeerComparisonAgent",
        (
            "你是同業比較分析師。只負責挑選至少2家同產業公司，並比較主要產品、毛利率、"
            "本益比、PB、EPS成長與評價。使用繁體中文並附來源。"
        ),
    )


def entry_strategy_agent() -> Agent:
    return specialist_agent(
        "EntryStrategyAgent",
        (
            "你是買進策略分析師。根據其他分析師輸出，負責合理買進價格與分批策略。"
            "必須輸出三階段配置：合理價附近30%、合理價以下10%為30%、景氣低谷/大跌時40%。"
            "使用繁體中文。"
        ),
        use_web=False,
    )


def six_way_pe_valuation_agent() -> Agent:
    return specialist_agent(
        "SixWayPEValuationAgent",
        (
            "你是本益比估值分析師。負責估算近4季EPS、預估EPS、固定本益比、滾動本益比、"
            "預估本益比，並計算六種合理價：近4季EPS×固定PE、近4季EPS×滾動PE、"
            "近4季EPS×預估PE、預估EPS×固定PE、預估EPS×滾動PE、預估EPS×預估PE。"
            "缺資料時合理估計並註明假設。使用繁體中文並附來源。"
        ),
    )


def visual_summary_agent() -> Agent:
    return Agent(
        name="VisualSummaryAgent",
        instructions=(
            "你是金融報告視覺設計師。根據分析摘要生成一張乾淨的繁體中文財務評分卡或合理價區間圖。"
            "視覺需適合深色介面，避免投資建議語氣。"
        ),
        model=financial_model(),
        tools=[
            ImageGenerationTool(
                tool_config={
                    "type": "image_generation",
                    "size": "1024x1024",
                    "quality": "low",
                }
            )
        ],
    )


def report_synthesis_agent() -> Agent:
    return Agent(
        name="FinancialReportOrchestrator",
        instructions=(
            "你是總編輯兼投資分析協調者。整合各專家輸出成完整繁體中文報告。"
            "必須包含使用者指定的 1 到 7 節、六種本益比估值表、合理價區間、"
            "目前股價偏高/合理/偏低判斷、成長或衰退風險提醒。"
            "若資料缺乏，保留專家假設與來源。最後必須逐字加入："
            "投資有風險，以上為財務觀點分析，不構成投資建議。"
        ),
        model=financial_model(),
    )

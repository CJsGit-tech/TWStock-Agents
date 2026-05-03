import os
from typing import Any

import twstock
from fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.responses import PlainTextResponse
from starlette.routing import Mount, Route
from twstock import BestFourPoint, Stock


MCP_SERVER_NAME = "twstock-mcp-fastmcp"

mcp = FastMCP(
    MCP_SERVER_NAME,
    instructions=(
        "Taiwan stock MCP server powered by twstock. Provides stock metadata, "
        "realtime quotes, historical OHLC data, moving averages, and Best Four Point signals."
    ),
)


def _data_to_dict(row: Any) -> dict[str, Any]:
    return {
        "date": row.date.strftime("%Y-%m-%d"),
        "capacity": row.capacity,
        "turnover": row.turnover,
        "open": row.open,
        "high": row.high,
        "low": row.low,
        "close": row.close,
        "change": row.change,
        "transaction": row.transaction,
        "note": getattr(row, "note", ""),
    }


def _stock_info_to_dict(stock_id: str) -> dict[str, Any]:
    info = twstock.codes[stock_id]
    return {
        "type": info.type,
        "code": info.code,
        "name": info.name,
        "isin": info.ISIN,
        "start": info.start,
        "market": info.market,
        "group": info.group,
        "cfi": info.CFI,
    }


def _load_stock(stock_id: str, initial_fetch: bool = True) -> Stock:
    return Stock(stock_id, initial_fetch=initial_fetch)


@mcp.tool
def get_stock_info(stock_id: str) -> dict[str, Any]:
    """Get Taiwan stock metadata from twstock.codes."""
    if stock_id not in twstock.codes:
        return {"success": False, "error": f"Stock ID {stock_id} was not found in twstock.codes."}
    return {"success": True, "stock": _stock_info_to_dict(stock_id)}


@mcp.tool
def get_realtime_quote(stock_id: str) -> dict[str, Any]:
    """Get realtime quote for one Taiwan stock ID."""
    return twstock.realtime.get(stock_id)


@mcp.tool
def get_realtime_quotes(stock_ids: list[str]) -> dict[str, Any]:
    """Get realtime quotes for multiple Taiwan stock IDs."""
    return twstock.realtime.get(stock_ids)


@mcp.tool
def get_historical_data(stock_id: str, year: int | None = None, month: int | None = None) -> dict[str, Any]:
    """Get historical OHLC trading data. If year/month are omitted, return the latest 31 trading days."""
    stock = _load_stock(stock_id, initial_fetch=year is None or month is None)
    if year is not None and month is not None:
        stock.fetch(year, month)
    return {
        "success": True,
        "stock": _stock_info_to_dict(stock_id) if stock_id in twstock.codes else {"code": stock_id},
        "data": [_data_to_dict(row) for row in stock.data],
    }


@mcp.tool
def calculate_moving_average(stock_id: str, days: int) -> dict[str, Any]:
    """Calculate a moving average from recent closing prices."""
    if days <= 0:
        return {"success": False, "error": "days must be greater than 0."}
    stock = _load_stock(stock_id)
    if len(stock.price) < days:
        return {
            "success": False,
            "error": f"Only {len(stock.price)} price points are available, fewer than requested days={days}.",
        }
    values = stock.moving_average(stock.price, days)
    return {
        "success": True,
        "stock_id": stock_id,
        "days": days,
        "latest": values[-1] if values else None,
        "values": values,
    }


@mcp.tool
def analyze_best_four_point(stock_id: str) -> dict[str, Any]:
    """Run twstock Best Four Point technical buy/sell signal analysis."""
    stock = _load_stock(stock_id)
    analyzer = BestFourPoint(stock)
    signal = analyzer.best_four_point()
    buy_reasons = analyzer.best_four_point_to_buy()
    sell_reasons = analyzer.best_four_point_to_sell()

    if signal is None:
        action = "Neutral"
        reasons: list[str] = []
    else:
        is_buy, reason_text = signal
        action = "Buy" if is_buy else "Sell"
        reasons = [reason.strip() for reason in reason_text.split(",") if reason.strip()]

    return {
        "success": True,
        "stock_id": stock_id,
        "action": action,
        "reasons": reasons,
        "buy_reasons": buy_reasons or None,
        "sell_reasons": sell_reasons or None,
        "latest_close": stock.price[-1] if stock.price else None,
        "latest_capacity": stock.capacity[-1] if stock.capacity else None,
    }


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
    mcp.run(transport="http", host="0.0.0.0", port=int(os.getenv("PORT", "8081")))

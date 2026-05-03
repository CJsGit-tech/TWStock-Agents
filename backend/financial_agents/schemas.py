import re
from typing import Any

from pydantic import BaseModel, Field


DISCLAIMER = "投資有風險，以上為財務觀點分析，不構成投資建議。"


class FinancialAnalysisRequest(BaseModel):
    stock: str = Field(..., min_length=1)
    question: str | None = None


class Source(BaseModel):
    title: str = ""
    url: str = ""
    note: str = ""


class SpecialistResult(BaseModel):
    summary: str = ""
    table_rows: list[dict[str, Any]] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    sources: list[Source] = Field(default_factory=list)
    confidence: str = "medium"


class SixWayValuationRow(BaseModel):
    method: str
    eps_source: str
    pe_source: str
    fair_value: str
    explanation: str


class FinalReport(BaseModel):
    stock: str
    sections: dict[str, str] = Field(default_factory=dict)
    six_way_valuation: list[SixWayValuationRow] = Field(default_factory=list)
    reasonable_price_range: str = ""
    valuation_judgement: str = ""
    risk_notes: list[str] = Field(default_factory=list)
    disclaimer: str = DISCLAIMER
    image: dict[str, Any] | None = None


def normalize_stock_input(raw: str) -> str:
    value = raw.strip()
    match = re.search(r"\b\d{4,6}\b", value)
    if match:
        return match.group(0)
    return value

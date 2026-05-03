Financial dispatch policy.

Current implementation uses deterministic backend rules instead of a Manager Agent:
- Parse stock code/name from the request.
- Preserve the original user question.
- Select only the sections implied by the question.
- Fetch low-cost structured MCP data before calling the model.
- Let one FinancialAnalysisAgent interpret the data and answer.

Section hints:
- overview: company profile, business model, products, customers.
- quote: realtime price, market state, recent stock data.
- technical: moving average, historical OHLC, Best Four Point, trend signals.
- valuation: PE, PB, fair value, reasonable price, valuation scenarios.
- growth: revenue growth, EPS growth, business momentum.
- financial_health: EPS, margins, ROE, balance sheet quality.
- cashflow: operating cash flow, free cash flow, debt, inventory.
- peers: peer comparison and industry positioning.
- entry_strategy: staged entry, risk framing, price scenarios.

This prompt is stored for governance and future LLM-based planning, but backend code is the source of truth for current dispatch behavior.

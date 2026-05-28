# 06. Report Delivery

## Goal

V1 reports should be generated from a constrained LINE request and delivered as AI-written HTML email through SendGrid.

## Report Pipeline

1. LINE webhook creates a `stock_report_requests` row from valid stock-plus-email input.
2. A background worker loads the request.
3. The worker resolves the stock name or stock number.
4. The worker gathers stock context and generates report content.
5. AI writes an email subject and HTML body.
6. SendGrid sends the report to the submitted email address.
7. Delivery results are written to `email_delivery_logs`.
8. Failures are retried or marked failed according to policy.

## Email Format

Version 1 should use HTML email because email is the desired report surface.

The email should include:

- Clear subject line.
- Requested stock name or stock number.
- Summary section.
- Business and theme notes.
- Key risks or caveats.
- Source/date context when available.
- Plain-text fallback or concise summary when practical.

SendGrid options:

- Direct HTML content: fastest for v1.
- Dynamic template with `dynamic_template_data`: cleaner after report layout stabilizes.

## First Report Type Recommendation

Start with a single-stock report, because v1 input is only stock name or stock number plus email.

Possible sections:

- Company overview.
- Theme or supply-chain relevance.
- Recent business direction.
- Basic valuation or financial health notes when data is available.
- Risk notes.
- AI-written summary.

## LINE Role In V1

LINE should only provide:

- Input collection.
- Invalid-format guidance.
- Accepted status.
- Failure status when useful and possible.

The report itself should not be sent in LINE for v1.

## Long-Running Work

LINE webhook handling should stay fast:

- Acknowledge the webhook quickly.
- Queue the report work.
- Send the finished result later through SendGrid.

## Delivery Policy

Delivery should be logged with:

- Report request ID.
- Target email.
- Request key or retry key.
- Delivery status.
- SendGrid message ID when available.
- Error message when delivery fails.
- Send timestamp.

Retries should only happen when safe, and duplicate delivery should be avoided with request keys and delivery logs.


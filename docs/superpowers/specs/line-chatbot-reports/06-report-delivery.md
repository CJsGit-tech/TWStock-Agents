# 06. Report Delivery

## Goal

Automatic reports should let active LINE users receive portfolio or stock updates without manually asking the chatbot.

## Report Pipeline

1. A scheduler selects active `line_report_subscriptions`.
2. A background worker loads the linked LINE user, portfolio, and report preferences.
3. The worker generates report content through the existing chatbot/report service.
4. A formatter converts the report into LINE-compatible messages.
5. The LINE client sends push messages to the linked `line_user_id`.
6. Delivery results are written to `line_delivery_logs`.
7. Failures are retried or marked failed according to policy.

## Message Format

Version 1 should use plain text summaries because that is the fastest reliable format.

Later versions can add:

- Flex Message report cards.
- Quick replies for actions such as refresh, explain, or view portfolio.
- Generated images for richer report snapshots.
- Links to report artifacts when content is too long for LINE messages.

## First Report Type Recommendation

Start with a daily portfolio summary if the user has a linked portfolio.

Why:

- It matches the current portfolio-aware backend.
- It has clear user value.
- It avoids needing a separate watchlist model first.

Possible report sections:

- Portfolio total value.
- Cash percentage.
- Top holdings.
- Largest gain/loss notes when available.
- Assistant-written summary.
- Optional risk or action notes.

## Long-Running Work

LINE webhook handling should stay fast. If report generation may take longer than the reply window or normal webhook response expectations:

- Acknowledge the webhook quickly.
- Queue the report work.
- Send the finished result later through LINE push.

## Delivery Policy

Delivery should be logged with:

- Target LINE user.
- Message type.
- Request key or retry key.
- Delivery status.
- Error message when delivery fails.
- Send timestamp.

Retries should only happen when safe, and duplicate delivery should be avoided with request keys and delivery logs.


# 05. Data Model And API

## Proposed Data Model Additions

### `line_users`

Stores LINE identities for request history, rate limits, and optional future access control.

Fields:

- `id`
- `line_user_id`
- `status`: `active`, `blocked`, or `watch`
- `created_at`
- `updated_at`
- `last_seen_at`

### `stock_report_requests`

Stores each v1 report request submitted through LINE.

Fields:

- `id`
- `line_user_id`
- `stock_identifier`
- `normalized_stock_id`
- `email`
- `status`: `accepted`, `generating`, `sent`, `failed`, or `rejected`
- `failure_reason`
- `created_at`
- `updated_at`
- `completed_at`

### `line_webhook_events`

Stores processed webhook IDs for idempotency and audit.

Fields:

- `id`
- `webhook_event_id`
- `line_user_id`
- `event_type`
- `received_at`
- `processed_at`
- `status`

### `blocked_email_addresses`

Stores email addresses that cannot receive reports.

Fields:

- `id`
- `email`
- `reason`
- `created_at`

### `email_delivery_logs`

Stores SendGrid delivery attempts.

Fields:

- `id`
- `report_request_id`
- `email`
- `provider`: `sendgrid`
- `request_key`
- `status`
- `provider_message_id`
- `error_message`
- `created_at`
- `sent_at`

## Suggested Modules

- `backend/api/line.py`: FastAPI router for LINE webhooks and admin/test endpoints.
- `backend/line/config.py`: LINE channel secret, access token, and feature flags.
- `backend/line/security.py`: signature verification.
- `backend/line/client.py`: LINE status replies.
- `backend/line/schemas.py`: internal event and message models.
- `backend/line/service.py`: event handling, v1 input parsing, request creation, and status replies.
- `backend/line/models.py`: SQLAlchemy tables for LINE users, webhook events, report requests, and blocklists.
- `backend/reports/service.py`: stock report generation orchestration.
- `backend/reports/email_writer.py`: AI subject and HTML body generation.
- `backend/email/sendgrid_client.py`: SendGrid Mail Send API integration.
- `backend/email/models.py`: email delivery logs.

## Suggested Endpoints

- `POST /api/line/webhook`: public LINE webhook endpoint.
- `GET /api/line/report-requests`: admin endpoint to inspect report requests.
- `POST /api/line/users/{id}/block`: admin endpoint to block a LINE user.
- `POST /api/email/test-send`: internal/admin endpoint to test SendGrid delivery.
- `POST /api/reports/stock/test-generate`: internal/admin endpoint to test report generation.

## Backend Contract Note

The LINE integration should not replace `/api/chatbot/stream`. For v1, it also should not expose `/api/chatbot/stream` directly to LINE users.

Instead, LINE should create constrained stock report requests. The report worker can reuse the same OpenAI configuration and relevant stock-analysis helpers behind a narrower report-generation service.


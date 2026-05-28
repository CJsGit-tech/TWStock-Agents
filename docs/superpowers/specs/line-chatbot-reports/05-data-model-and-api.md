# 05. Data Model And API

## Proposed Data Model Additions

### `line_users`

Stores LINE identities that are allowed or pending.

Fields:

- `id`
- `line_user_id`
- `app_user_id`
- `default_portfolio_id`
- `status`: `pending`, `active`, or `blocked`
- `created_at`
- `updated_at`
- `last_seen_at`

### `line_invite_codes`

Stores one-time or limited-use invite codes.

Fields:

- `id`
- `code_hash`
- `app_user_id`
- `default_portfolio_id`
- `status`: `active`, `used`, `expired`, or `revoked`
- `expires_at`
- `used_by_line_user_id`
- `used_at`
- `created_at`

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

### `line_report_subscriptions`

Stores report delivery preferences.

Fields:

- `id`
- `line_user_id`
- `portfolio_id`
- `report_type`
- `schedule`
- `timezone`
- `status`: `active`, `paused`, or `cancelled`
- `created_at`
- `updated_at`

### `line_delivery_logs`

Stores reply and push delivery attempts.

Fields:

- `id`
- `line_user_id`
- `message_type`
- `request_key`
- `status`
- `error_message`
- `created_at`
- `sent_at`

## Suggested Modules

- `backend/api/line.py`: FastAPI router for LINE webhooks and admin/test endpoints.
- `backend/line/config.py`: LINE channel secret, access token, and feature flags.
- `backend/line/security.py`: signature verification.
- `backend/line/client.py`: reply, push, multicast, and loading-indicator calls.
- `backend/line/schemas.py`: internal event and message models.
- `backend/line/service.py`: event handling, user lookup, linking, and routing.
- `backend/line/reports.py`: report command handling and report delivery helpers.
- `backend/line/models.py`: SQLAlchemy tables for LINE users, invite codes, events, subscriptions, and delivery logs.

## Suggested Endpoints

- `POST /api/line/webhook`: public LINE webhook endpoint.
- `POST /api/line/invite-codes`: admin endpoint to create invite codes.
- `GET /api/line/users`: admin endpoint to inspect linked users.
- `POST /api/line/users/{id}/block`: admin endpoint to revoke access.
- `POST /api/line/reports/test-send`: internal/admin endpoint to test a report send.

## Backend Contract Note

The LINE integration should not replace `/api/chatbot/stream`. It should call the same underlying chatbot service and adapt the streaming output into LINE-compatible messages.

This keeps the web client and LINE client as separate delivery channels over the same backend intelligence.


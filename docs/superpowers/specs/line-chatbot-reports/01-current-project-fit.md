# 01. Current Project Fit

## What Already Exists

The project already has the main backend pieces needed behind the LINE adapter:

- `backend/app.py` creates the FastAPI app and mounts the current API routers.
- `backend/api/chatbot.py` exposes `POST /api/chatbot/stream`.
- `backend/chatbot/service.py` builds the GPT-5 chatbot agent and streams NDJSON events.
- `backend/portfolio` stores portfolios, holdings, chat sessions, and persistence helpers.
- `backend/chatbot/approvals.py` supports human approval before applying portfolio mutations.
- `docs/API_EXAMPLES.md` documents the current chatbot and portfolio API shape.

## Main Integration Mismatch

The current chatbot API streams NDJSON to a web client. LINE webhooks are request/response events, and LINE messages are sent through reply or push APIs.

A LINE integration should consume the backend stream internally, collect the final `message_completed` content, and send that final content to LINE.

For longer report generation, the webhook should acknowledge quickly, run the report in the background, then send the finished result later through LINE push messages.

## What Is Missing

The project does not yet have these pieces:

- LINE webhook endpoint, such as `POST /api/line/webhook`.
- LINE channel configuration: channel secret and channel access token.
- LINE request signature verification using the `x-line-signature` header.
- LINE event parser for text messages, postbacks, follow events, and delivery edge cases.
- LINE user registry that maps `line_user_id` to an app user, portfolio, and access status.
- Account linking flow, preferably invite-code based for the first private beta.
- LINE reply/push client for sending messages back to users.
- Adapter that converts LINE text events into the existing chatbot request format.
- Adapter that converts chatbot output into LINE text, Flex Messages, or report images.
- Background job or scheduler layer for automatic reports.
- Idempotency handling for webhook redelivery and push retries.
- Delivery logs for report sends, failures, and retries.
- Tests for webhook auth, user authorization, event parsing, chatbot adapter behavior, and push delivery.

## LINE Capabilities To Use

LINE Messaging API supports:

- Webhooks for receiving user messages and account events.
- Reply messages for responding to a specific webhook event.
- Push messages for sending messages later to a known LINE user.
- Multicast or narrowcast style delivery for sending to multiple users, if needed later.
- Text messages, template messages, image messages, quick replies, and Flex Messages.
- Webhook signature verification with the channel secret.
- Retry/idempotency controls for delivery requests.

Useful official references:

- LINE Messaging API overview: https://developers.line.biz/en/docs/messaging-api/overview/
- Receiving messages: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- Sending messages: https://developers.line.biz/en/docs/messaging-api/sending-messages/
- Verify webhook signature: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- Message types: https://developers.line.biz/en/docs/messaging-api/message-types/
- Quick replies: https://developers.line.biz/en/docs/messaging-api/using-quick-reply/


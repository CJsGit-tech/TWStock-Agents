# 01. Current Project Fit

## What Already Exists

The project already has backend pieces that can support report generation:

- `backend/app.py` creates the FastAPI app and mounts the current API routers.
- `backend/api/chatbot.py` exposes `POST /api/chatbot/stream`.
- `backend/chatbot/service.py` builds the GPT-5 chatbot agent and streams NDJSON events.
- `backend/portfolio` stores portfolios, holdings, chat sessions, and persistence helpers.
- `backend/chatbot/approvals.py` supports human approval before applying portfolio mutations.
- `docs/API_EXAMPLES.md` documents the current chatbot and portfolio API shape.

## V1 Fit

The current chatbot API streams NDJSON to a web client. V1 should not expose that open-ended chat interface to LINE.

LINE should only collect:

- stock name or stock number
- email address

The backend should then generate the report asynchronously and send the result through SendGrid as HTML email.

## What Is Missing

The project does not yet have:

- LINE webhook endpoint, such as `POST /api/line/webhook`.
- LINE channel configuration: channel secret and channel access token.
- LINE request signature verification using the `x-line-signature` header.
- Parser for the v1 message format: `<stock name or stock number> <email>`.
- Email validation and stock identifier validation.
- Report request persistence with status tracking.
- Report generation service focused on single-stock reports.
- AI email writer that produces subject line and HTML body.
- SendGrid configuration: API key, verified sender, optional template ID.
- SendGrid client for sending HTML emails.
- LINE reply client for short status messages only.
- Background job layer for report generation and email sending.
- Idempotency handling for LINE webhook redelivery.
- Rate limits and blocklists for abuse control.
- Delivery logs for SendGrid sends, failures, and retries.

## External Capabilities To Use

LINE Messaging API supports webhooks, reply messages, text messages, and webhook signature verification.

SendGrid supports HTML email delivery through its Mail Send API, dynamic templates, and personalization fields. For v1, direct AI-generated HTML is the fastest path. A SendGrid dynamic template is cleaner once the report layout stabilizes.

Useful official references:

- LINE Messaging API overview: https://developers.line.biz/en/docs/messaging-api/overview/
- Receiving messages: https://developers.line.biz/en/docs/messaging-api/receiving-messages/
- Sending messages: https://developers.line.biz/en/docs/messaging-api/sending-messages/
- Verify webhook signature: https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
- SendGrid Email API: https://sendgrid.com/en-us/solutions/email-api
- SendGrid personalizations: https://www.twilio.com/docs/sendgrid/for-developers/sending-email/personalizations/
- SendGrid dynamic templates: https://sendgrid.com/en-us/solutions/email-api/dynamic-email-templates


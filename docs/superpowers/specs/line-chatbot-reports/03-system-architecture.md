# 03. System Architecture

## Full System Diagram

```mermaid
flowchart TD
    User["LINE user"] -->|"Sends stock + email"| LinePlatform["LINE Platform"]
    LinePlatform -->|"Webhook event with x-line-signature"| LineWebhook["POST /api/line/webhook"]

    subgraph LineIntake["LINE Intake Layer"]
        LineWebhook --> SignatureVerifier["Verify LINE signature"]
        SignatureVerifier --> EventParser["Parse LINE event"]
        EventParser --> Idempotency["Check webhookEventId idempotency"]
        Idempotency --> InputParser["Parse stock identifier + email"]
        InputParser -->|"invalid"| InvalidReply["Usage or validation reply"]
        InputParser -->|"valid"| RequestStore["Create stock_report_request"]
        RequestStore --> AbuseChecks["Rate limit and block checks"]
        AbuseChecks -->|"rejected"| RejectedReply["Rejected status reply"]
        AbuseChecks -->|"accepted"| AcceptedReply["Accepted status reply"]
        InvalidReply --> LineClient["LINE reply client"]
        RejectedReply --> LineClient
        AcceptedReply --> LineClient
    end

    subgraph ReportGeneration["Report Generation"]
        RequestStore --> ReportWorker["Background report worker"]
        ReportWorker --> StockResolver["Resolve stock identifier"]
        StockResolver --> StockData["Stock data / MCP / financial helpers"]
        StockData --> ReportPrompt["Report prompt builder"]
        ReportPrompt --> OpenAI["OpenAI GPT-5"]
        OpenAI --> EmailWriter["AI subject + HTML body"]
    end

    subgraph EmailDelivery["SendGrid Email Delivery"]
        EmailWriter --> SendGridClient["SendGrid Mail Send API"]
        SendGridClient --> DeliveryLog["Email delivery log"]
        SendGridClient --> EmailInbox["User email inbox"]
    end

    LineClient -->|"status reply only"| LinePlatform
    LinePlatform -->|"Display status"| User
```

## V1 Request Flow

1. LINE sends a webhook to `POST /api/line/webhook`.
2. Backend verifies `x-line-signature`.
3. Backend parses the message event.
4. Backend checks idempotency with `webhookEventId`.
5. Backend parses only stock name or stock number plus email.
6. Invalid messages receive a LINE usage reply.
7. Valid messages create a report request.
8. Backend applies block and rate-limit checks.
9. Backend replies in LINE with accepted or rejected status.
10. Background worker generates the report and sends it through SendGrid.

## Email Report Flow

1. Report worker picks up an accepted report request.
2. Worker resolves the stock identifier.
3. Worker gathers required stock context.
4. AI generates an email subject and HTML body.
5. Backend sends the email through SendGrid.
6. Backend stores delivery status and SendGrid response details.
7. If delivery fails safely, backend retries according to policy.


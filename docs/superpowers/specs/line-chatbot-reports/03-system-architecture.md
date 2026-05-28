# 03. System Architecture

## Full System Diagram

```mermaid
flowchart TD
    User["Registered or unknown LINE user"] -->|"Message Official Account"| LinePlatform["LINE Platform"]
    LinePlatform -->|"Webhook event with x-line-signature"| LineWebhook["POST /api/line/webhook"]

    subgraph LineIntegration["Missing LINE Integration Layer"]
        LineWebhook --> SignatureVerifier["Verify LINE signature"]
        SignatureVerifier --> EventParser["Parse LINE event"]
        EventParser --> Idempotency["Check webhookEventId idempotency"]
        Idempotency --> UserLookup["Lookup line_user_id"]
        UserLookup -->|"unknown"| LinkOrDeny["Invite-code linking or access denied"]
        UserLookup -->|"active"| IntentRouter["Route text, command, or report action"]
        UserLookup -->|"blocked"| BlockedReply["Blocked/access denied reply"]
        IntentRouter --> ChatAdapter["LINE to ChatRequest adapter"]
        IntentRouter --> ReportCommand["Report command handler"]
        LinkOrDeny --> LineClient["LINE reply/push client"]
        BlockedReply --> LineClient
    end

    subgraph CurrentBackend["Current TWStock-Agents Backend"]
        ChatAdapter --> ChatStream["/api/chatbot/stream service"]
        ChatStream --> ChatService["backend/chatbot/service.py"]
        ChatService --> OpenAI["OpenAI GPT-5 Agent"]
        ChatService --> PortfolioMCP["Portfolio MCP/read tools"]
        PortfolioMCP --> PortfolioDB["Portfolio and chat-session DB"]
        ChatService --> ApprovalFlow["Portfolio approval flow"]
    end

    subgraph ReportDelivery["New Automatic Report Pipeline"]
        ReportSchedule["Report subscriptions/schedules"] --> ReportWorker["Background report worker"]
        ReportWorker --> ReportGenerator["Generate report through chatbot/report service"]
        ReportGenerator --> ReportFormatter["Format as text, Flex Message, or image"]
        ReportFormatter --> DeliveryLog["Delivery log and retry policy"]
        DeliveryLog --> LineClient
    end

    ChatStream -->|"message_completed"| ResponseFormatter["LINE response formatter"]
    ResponseFormatter --> LineClient
    ReportCommand --> ReportWorker

    LineClient -->|"reply message or push message"| LinePlatform
    LinePlatform -->|"Display result"| User
```

## Registered Chat Flow

1. LINE sends a webhook to `POST /api/line/webhook`.
2. Backend verifies `x-line-signature`.
3. Backend parses the message event.
4. Backend checks whether `source.userId` maps to an active `line_users` row.
5. Backend converts the LINE text into a chatbot user message.
6. Backend calls the existing chatbot stream service.
7. Backend accumulates `text_delta` chunks and waits for `message_completed`.
8. Backend formats the final answer for LINE.
9. Backend sends a reply message using LINE's reply API.
10. Backend records the event and delivery result.

## Unknown User Flow

1. LINE sends a webhook from an unknown `line_user_id`.
2. Backend verifies the request and checks the registry.
3. If the message starts with `link <code>`, backend validates the invite code.
4. If valid, backend activates the LINE user and sends a success reply.
5. If invalid or absent, backend sends a short linking instruction or access-denied reply.
6. Backend does not call the chatbot or report service.

## Automatic Report Flow

1. Report scheduler selects active report subscriptions.
2. Background worker loads user, portfolio, and report preferences.
3. Worker generates report content through the report/chatbot service.
4. Formatter converts the report into LINE-compatible messages.
5. LINE client sends push messages to the linked `line_user_id`.
6. Delivery result is logged.
7. Failures are retried or marked failed according to policy.


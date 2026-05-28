# 07. Rollout And Testing

## Phased Delivery Plan

### Phase 1: Private LINE Chat Beta

Scope:

- LINE webhook endpoint.
- Signature verification.
- Text message handling.
- Invite-code linking.
- Active-user authorization.
- Plain text chatbot replies.

Outcome:

- Registered users can ask the assistant questions through LINE.
- Unknown users cannot use the assistant.

### Phase 2: Portfolio Context

Scope:

- Link LINE user to a default portfolio.
- Include `portfolio_id` in chatbot requests.
- Preserve approval flow for portfolio mutations.

Outcome:

- Registered users can ask portfolio-aware questions in LINE.

### Phase 3: Automatic Reports

Scope:

- Report subscriptions.
- Background report generation.
- LINE push delivery.
- Delivery logs and retry policy.

Outcome:

- Registered users can receive scheduled reports in LINE.

### Phase 4: Better LINE UX

Scope:

- Flex Message report cards.
- Quick replies for common actions.
- Report links or generated images for longer content.
- Optional LIFF or LINE Login account linking.

Outcome:

- The LINE experience becomes easier to use and more polished on mobile.

## Testing Plan

Unit tests:

- Signature verification accepts valid signatures and rejects invalid signatures.
- Invite-code linking handles valid, invalid, expired, and reused codes.
- Unknown, active, and blocked LINE users are routed correctly.
- LINE text messages are converted into chatbot requests correctly.
- Chatbot stream output is accumulated into a final LINE reply.
- Duplicate webhook event IDs do not trigger duplicate replies or report jobs.

Integration tests:

- `POST /api/line/webhook` rejects invalid signatures.
- `POST /api/line/webhook` links a user with a valid invite code.
- `POST /api/line/webhook` calls the chatbot for active users.
- Report worker sends a push message and writes a delivery log.

Manual testing:

- Use LINE Developers webhook test tools or a tunnel such as ngrok for local testing.
- Add the Official Account from a test LINE account.
- Test unknown-user denial, invite linking, normal chat, and one report push.

## Open Product Decisions

These decisions should be confirmed before implementation:

- Should unknown users receive linking instructions or a silent deny?
- Who creates invite codes: admin-only API, CLI script, or web UI?
- Does every LINE user map to one default portfolio at first?
- Which report should ship first: daily portfolio summary, stock watchlist, or weekly strategy report?
- Should report delivery times use Taiwan time by default?
- Should blocked users receive a message or no response?

## Definition Of Done

The desired outcome is reached when:

- A LINE Official Account can call the backend webhook.
- Backend verifies LINE signatures.
- Only active registered LINE users can use the bot.
- Unknown or blocked users cannot trigger chatbot/report work.
- Active users can send a message and receive a chatbot response in LINE.
- Active users can receive at least one generated report by LINE push message.
- The system records enough event and delivery logs to debug failures.
- Tests cover signature verification, authorization, linking, chat routing, and report delivery.


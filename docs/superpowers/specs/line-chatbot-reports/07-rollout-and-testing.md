# 07. Rollout And Testing

## Phased Delivery Plan

### Phase 1: LINE Intake And SendGrid Email Beta

Scope:

- LINE webhook endpoint.
- Signature verification.
- Text parsing for stock name or stock number plus email.
- Invalid-format replies.
- Report request persistence.
- SendGrid configuration.
- AI HTML email generation.
- SendGrid delivery logging.

Outcome:

- Users can submit `stock identifier + email` through LINE.
- Users receive the report by email.
- LINE only sends short status replies.

### Phase 2: Abuse Controls And Better Report Quality

Scope:

- Rate limits by LINE user ID and email.
- Blocklists for LINE users and email addresses.
- Better stock identifier normalization.
- Report quality checks and safer missing-data handling.

Outcome:

- The v1 intake can handle public or semi-public testing safely.

### Phase 3: Email Template And Tracking

Scope:

- SendGrid dynamic template support.
- HTML template polish.
- Delivery status inspection.
- Optional unsubscribe or email preference handling.

Outcome:

- Email reports become easier to maintain and monitor.

### Phase 4: Optional Registered Access

Scope:

- Invite-code access.
- LINE Login or LIFF linking.
- User accounts.
- Saved report history.
- Optional scheduled report subscriptions.

Outcome:

- The system can evolve from open constrained intake to registered or paid access.

## Testing Plan

Unit tests:

- Signature verification accepts valid signatures and rejects invalid signatures.
- V1 parser accepts stock-plus-email messages.
- V1 parser rejects missing stock, missing email, and open-ended prompts.
- Email validation accepts and rejects expected formats.
- Duplicate webhook event IDs do not create duplicate report jobs.
- Blocked LINE users and blocked emails cannot create report jobs.
- SendGrid payload builder creates subject, HTML content, and recipient correctly.

Integration tests:

- `POST /api/line/webhook` rejects invalid signatures.
- `POST /api/line/webhook` accepts a valid stock-plus-email request.
- `POST /api/line/webhook` rejects invalid message shapes with a usage reply.
- Report worker generates an HTML report and calls the email client.
- SendGrid delivery writes an email delivery log.

Manual testing:

- Use LINE Developers webhook test tools or a tunnel such as ngrok for local testing.
- Add the Official Account from a test LINE account.
- Test valid report request, invalid format, invalid email, duplicate webhook, and one SendGrid email.

## Open Product Decisions

These decisions should be confirmed before implementation:

- Should v1 allow any LINE user who provides an email, or require an invite code immediately?
- What exact input formats are accepted: `2330 email`, `台積電 email`, or both?
- Should the email address be verified before sending reports?
- Which single-stock report sections are mandatory in v1?
- Should SendGrid use direct AI-generated HTML first or a dynamic template from day one?
- Should blocked users receive a message or no response?

## Definition Of Done

The desired v1 outcome is reached when:

- A LINE Official Account can call the backend webhook.
- Backend verifies LINE signatures.
- Backend accepts only stock name or stock number plus email.
- All other LINE text is rejected with a short usage reply.
- Backend creates a report request for valid input.
- AI generates a subject and HTML email body.
- SendGrid sends at least one generated report email.
- The system records enough event and delivery logs to debug failures.
- Tests cover signature verification, input parsing, validation, idempotency, report generation, and SendGrid delivery.


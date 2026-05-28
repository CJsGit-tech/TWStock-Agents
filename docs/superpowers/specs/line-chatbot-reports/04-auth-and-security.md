# 04. Auth And Security

## V1 Access Model

For v1, the primary controls are constrained input, webhook verification, email validation, idempotency, and rate limiting.

Every LINE webhook event should follow this rule:

1. Verify the request came from LINE.
2. Extract the LINE user ID from the webhook event source.
3. Parse only a stock name or stock number plus an email address.
4. Reject everything else.
5. Check duplicate events, blocked LINE users, blocked email addresses, and rate limits.
6. Create a report job only after those checks pass.

## Registration Decision

Do not require invite-code linking for v1 unless the product needs a private beta immediately.

The v1 user flow is:

1. User sends `2330 user@example.com` or `台積電 user@example.com`.
2. Backend stores the `line_user_id` for abuse prevention and request history.
3. Backend stores the submitted email on the report request.
4. Backend sends the generated HTML report to that email through SendGrid.

This keeps v1 small and avoids registration before the report concept is proven.

## Future Access Options

### Open Constrained Intake

Any LINE user can submit only stock identifier plus email.

Pros:

- Best for proving demand.
- No account linking needed.
- The constrained format limits chatbot abuse.

Cons:

- Requires rate limits and email abuse controls.
- Users can submit someone else's email unless verification is added.
- Not enough for paid or private access.

### Invite-Code Linking

User sends a one-time code in LINE to unlock report requests.

Pros:

- Simple enough for a private beta.
- Gives explicit access control.
- Does not require full LINE Login or LIFF setup.

Cons:

- Invite code management must be built.
- Users must type a linking command before requesting a report.
- Later consumer-scale onboarding may need a richer flow.

### LINE Login Or LIFF Linking

User logs in through LINE Login or a LIFF-based flow.

Pros:

- Best long-term user experience.
- Stronger fit for a public or paid product.
- Can integrate with an app account system.

Cons:

- More setup and frontend work.
- Requires a clearer user account model than v1 needs.
- Too large for the first proof of outcome.

## Security Requirements

- Always verify `x-line-signature` before parsing or processing webhook content.
- Never accept a claimed LINE user ID from a client request; use only the webhook event source.
- Do not expose open-ended chatbot prompts through LINE in v1.
- Only accept messages matching the v1 stock-plus-email format.
- Validate and normalize email addresses before creating report jobs.
- Validate and normalize stock identifiers before report generation.
- Store SendGrid API keys and sender configuration in environment variables.
- Store LINE channel access token and channel secret in environment variables.
- Do not log access tokens or full webhook payloads if they include sensitive user content.
- Avoid logging full email report bodies unless needed for debugging.
- Use webhook idempotency to avoid duplicate processing during LINE redelivery.
- Apply rate limits by LINE user ID, email address, and stock identifier.
- Support blocklists for abusive LINE users and email addresses.

## Error Handling

- Invalid signature: return `403` and do not process the event.
- Duplicate webhook event: return success without repeating side effects.
- Invalid format: reply with one usage example.
- Invalid email: reply with a short email-format error.
- Unknown stock identifier: reply with a short stock-format error when detected early, or mark the job failed.
- Blocked user or email: reply with access denied or stay silent, depending on product preference.
- Report generation failure: record failure and reply in LINE if still possible.
- SendGrid delivery failure: record failed delivery and retry only when safe.


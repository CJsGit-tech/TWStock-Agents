# 04. Auth And Security

## Access Model

Only active, registered LINE users should be able to use chatbot or report features.

Every LINE webhook event should follow this rule:

1. Verify the request came from LINE.
2. Extract the LINE user ID from the webhook event source.
3. Look up that LINE user in the backend registry.
4. Allow chatbot/report work only when the user exists and has `status = active`.
5. Deny, link, or ignore all other users.

## Recommended Linking Approach

Start with invite-code linking.

User flow:

1. Admin creates an invite code for a user or portfolio.
2. User sends `link ABC123` to the LINE Official Account.
3. Backend validates the invite code.
4. Backend stores the `line_user_id`, internal app user or portfolio mapping, and active status.
5. Backend marks the code as used.

This is better for the first private beta than full LINE Login or LIFF because it proves access control with less infrastructure.

## Alternatives

### Admin Pre-Registration

Admin manually adds allowed LINE user IDs to the database.

Pros:

- Very simple.
- Good for internal testing.
- Minimal user-facing flow.

Cons:

- Admin must discover and enter LINE user IDs.
- Poor fit for a beta with external users.
- Does not give users a natural onboarding path.

### Invite-Code Linking

User sends a one-time code in LINE to link the account.

Pros:

- Simple enough for a private beta.
- Gives explicit access control.
- Does not require full LINE Login or LIFF setup.
- Works well with the existing backend.

Cons:

- Invite code management must be built.
- Users must type a linking command.
- Later consumer-scale onboarding may need a richer flow.

### LINE Login Or LIFF Linking

User logs in through LINE Login or a LIFF-based flow.

Pros:

- Best long-term user experience.
- Stronger fit for a public product.
- Can integrate with an app account system.

Cons:

- More setup and frontend work.
- Requires a clearer user account model than the project currently has.
- Too large for the first proof of outcome.

## Security Requirements

- Always verify `x-line-signature` before parsing or processing webhook content.
- Never accept a claimed LINE user ID from a client request; use only the webhook event source.
- Deny all chatbot/report requests unless `line_user.status == active`.
- Store LINE channel access token and channel secret in environment variables.
- Do not log access tokens or full webhook payloads if they include sensitive user content.
- Use one-time invite codes or hashed invite codes in storage.
- Use webhook idempotency to avoid duplicate processing during LINE redelivery.
- Keep portfolio mutation approval behavior; LINE chat should not bypass approval.

## Error Handling

- Invalid signature: return `403` and do not process the event.
- Duplicate webhook event: return success without repeating side effects.
- Unknown user: reply with linking instructions or deny access.
- Blocked user: reply with access denied or stay silent, depending on product preference.
- Chatbot failure: reply with a short failure message and log details server-side.
- LINE delivery failure: record failed delivery and retry only when safe.
- Long report generation: acknowledge the webhook quickly and send result later by push.


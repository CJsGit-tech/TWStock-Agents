# LINE Chatbot And Report Delivery Specs

Date: 2026-05-28
Status: Draft for user review

This spec set describes how TWStock-Agents can connect to LINE so registered users can chat with the backend and receive automatic reports.

## Objective

Users should be able to interact with TWStock-Agents from LINE only after they are registered or linked. The same integration should later support automatic report delivery, so the backend can generate portfolio or stock reports and send them to approved users through LINE.

The first useful outcome is a private beta flow:

1. A user adds the LINE Official Account.
2. The user links their LINE identity with an invite code or existing app account.
3. The user sends a stock or portfolio question in LINE.
4. The backend verifies the LINE request, confirms the LINE user is active, calls the existing chatbot/report logic, and replies in LINE.
5. Later, the backend generates scheduled reports and pushes them to that registered LINE user.

## Spec Documents

- [01-current-project-fit.md](01-current-project-fit.md): what already exists and what is missing.
- [02-user-stories.md](02-user-stories.md): objective-check user stories and acceptance criteria.
- [03-system-architecture.md](03-system-architecture.md): full system diagram and message flows.
- [04-auth-and-security.md](04-auth-and-security.md): registered-user access, linking, signature verification, and denial behavior.
- [05-data-model-and-api.md](05-data-model-and-api.md): proposed tables, modules, and endpoints.
- [06-report-delivery.md](06-report-delivery.md): automatic report pipeline and LINE presentation.
- [07-rollout-and-testing.md](07-rollout-and-testing.md): phased build plan, tests, and definition of done.

## Recommended First Build

Start with an invite-code authenticated LINE adapter:

1. Add LINE configuration and webhook verification.
2. Add LINE user registry and invite-code linking.
3. Add text-message chatbot replies for active users.
4. Add report generation as an internal background job.
5. Add LINE push delivery for generated reports.
6. Upgrade report formatting from plain text to Flex Messages after the content stabilizes.

This path proves the desired outcome without requiring full LINE Login, LIFF, billing, or a larger identity system.


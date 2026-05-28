# LINE Intake And Email Report Delivery Specs

Date: 2026-05-28
Status: Draft for user review

This spec set describes a revised v1: LINE is only an intake channel, and SendGrid delivers the generated report by email.

## V1 Objective

Users can send only a stock name or stock number plus an email address through LINE. They cannot have an open-ended chatbot conversation in LINE for v1.

The backend validates the request, creates a report job, has AI write an HTML email report, and sends the result to the provided email address through SendGrid.

Example valid messages:

- `2330 user@example.com`
- `台積電 user@example.com`

## First Useful Outcome

1. A user adds the LINE Official Account.
2. The user sends one constrained message: stock name or stock number plus email.
3. The backend verifies the LINE webhook signature.
4. The backend validates stock input and email format.
5. The backend creates a report job.
6. AI generates a subject line and HTML email body.
7. SendGrid sends the report to the user's email.
8. LINE replies only with status, such as accepted, invalid format, or failed.

## Spec Documents

- [01-current-project-fit.md](01-current-project-fit.md): what already exists and what is missing for the v1 intake/email flow.
- [02-user-stories.md](02-user-stories.md): objective-check user stories and acceptance criteria.
- [03-system-architecture.md](03-system-architecture.md): full system diagram and message flows.
- [04-auth-and-security.md](04-auth-and-security.md): webhook verification, constrained input, abuse controls, and optional future registration.
- [05-data-model-and-api.md](05-data-model-and-api.md): proposed tables, modules, and endpoints.
- [06-report-delivery.md](06-report-delivery.md): AI HTML email report pipeline and SendGrid delivery.
- [07-rollout-and-testing.md](07-rollout-and-testing.md): phased build plan, tests, and definition of done.

## Recommended First Build

1. Add LINE configuration and webhook verification.
2. Parse only messages that contain stock name or stock number plus email.
3. Reject all other LINE messages with a short usage instruction.
4. Persist accepted report requests.
5. Generate HTML email content with AI.
6. Send the report through SendGrid.
7. Reply in LINE with status only.

This proves the core outcome without full LINE Login, LIFF, open-ended LINE chat, or in-LINE report rendering.


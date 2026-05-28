# 02. User Stories

These user stories check whether the implementation objective matches the desired v1 outcome.

## Constrained LINE Input

As a user, I want to request a report by sending only a stock name or stock number and my email address, so that I can receive the result without learning commands.

Acceptance criteria:

- Valid examples include `2330 user@example.com` and `台積電 user@example.com`.
- Messages without an email address are rejected.
- Messages without a stock name or stock number are rejected.
- Extra open-ended prompts are not processed as chatbot requests.
- LINE replies with a short format instruction when input is invalid.

## Email Report Request

As a user, I want the system to email the report to the address I provide, so that LINE is only used for submission and status.

Acceptance criteria:

- Backend validates email format before creating a report job.
- Backend stores the submitted email with the report request.
- Backend replies in LINE when the request is accepted.
- Backend sends the generated report through SendGrid.
- Backend logs whether the email send succeeded or failed.

## AI HTML Report

As a user, I want the email to be written and formatted by AI, so that the report is readable and useful in an email client.

Acceptance criteria:

- AI generates a subject line and HTML body.
- The HTML email includes the requested stock identifier.
- The report uses clear sections, not a raw chatbot transcript.
- The email has a plain-text fallback or concise text summary when practical.
- The report does not include unsupported claims when data is unavailable.

## LINE Status Replies

As a user, I want LINE to tell me whether my request was accepted or rejected, so that I know what happened after submitting.

Acceptance criteria:

- Valid requests receive a short accepted reply.
- Invalid requests receive a short usage example.
- If report generation or email delivery fails, the user receives a short failure message when possible.
- Full reports are not sent in LINE for v1.

## Abuse And Duplicate Control

As an operator, I want duplicate and abusive requests controlled, so that users cannot accidentally or intentionally trigger excessive email sends.

Acceptance criteria:

- Duplicate LINE webhook events do not send duplicate emails.
- Basic rate limits apply by LINE user ID and email address.
- Delivery logs retain request status and SendGrid response details.
- Blocked LINE users or blocked email addresses cannot create new report jobs.

## Future Registered Access

As an operator, I may later want registered-only access, so that the public LINE intake can become private or paid.

Acceptance criteria:

- The v1 design does not require full account registration.
- The data model can later mark LINE users or emails as allowed, blocked, or subscribed.
- Future invite-code or LINE Login linking can be added without changing the v1 request format.


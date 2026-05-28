# 02. User Stories

These user stories are meant to help check whether the implementation objective matches the desired outcome.

## Access And Registration

As an admin, I want to register who can use the LINE bot, so that private portfolio or report functionality is not available to unknown LINE users.

Acceptance criteria:

- Unknown LINE users cannot trigger chatbot or report generation.
- Unknown LINE users receive a short account-linking or access-denied message.
- Active LINE users can use the bot.
- Blocked LINE users cannot use the bot even if they were previously linked.

## Invite-Code Linking

As a user, I want to link my LINE account with an invite code, so that I can use the bot without needing a full web login flow.

Acceptance criteria:

- User can send a command such as `link ABC123`.
- Backend validates the invite code.
- Backend stores the LINE user ID and links it to an internal app user or portfolio.
- Used or expired invite codes cannot be reused.
- The user receives a clear success or failure message.

## Chat Through LINE

As a registered user, I want to ask questions in LINE, so that I can interact with the existing assistant without opening the web app.

Acceptance criteria:

- User sends a text message to the LINE Official Account.
- Backend verifies the webhook came from LINE.
- Backend checks the LINE user is active.
- Backend converts the text into the current chatbot message format.
- Backend calls the existing chatbot service.
- Backend sends the final assistant answer back to LINE.

## Portfolio-Aware Chat

As a registered user with a linked portfolio, I want the LINE bot to understand my selected portfolio, so that it can answer portfolio-specific questions.

Acceptance criteria:

- User account has a default portfolio or an explicit portfolio selection.
- Chatbot request includes the linked `portfolio_id`.
- Read-only portfolio tools can be used when helpful.
- Portfolio mutation proposals still require approval and are not silently applied.

## Automatic Reports

As a registered user, I want to receive scheduled reports in LINE, so that I can get portfolio or stock updates without manually asking.

Acceptance criteria:

- User can be subscribed to one or more report schedules.
- Backend generates reports in the background.
- Backend sends generated reports through LINE push messages.
- Failed sends are logged and retried according to a defined policy.
- User can be unsubscribed or blocked from future report delivery.

## Report Presentation

As a user, I want reports to be readable inside LINE, so that I can quickly understand the result on mobile.

Acceptance criteria:

- Version 1 can send plain text summaries.
- Later versions can use Flex Messages for structured cards.
- Large reports are split into multiple messages or linked to a generated artifact.
- The message includes enough context to understand the report without opening the web app.


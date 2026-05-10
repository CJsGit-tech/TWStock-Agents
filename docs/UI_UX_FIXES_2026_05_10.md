# Frontend UI/UX Bug Fixes — 2026-05-10

This document captures a historical frontend bug-fix pass for `frontend/src/main.tsx` and `frontend/src/styles.css`. It is not the current architecture reference; see [`CURRENT_ARCHITECTURE.md`](./CURRENT_ARCHITECTURE.md) for the current session persistence, Event Logs, and button-triggered visualization structure.

## Summary

Fifteen issues across three severity tiers were addressed in the original pass. At the time, the changes were scoped to the frontend only. Later work added backend/API changes for chat sessions, session-grouped event logs, and explicit visualization generation.

---

## High-severity bugs

### 1. Auto-scroll hijacks the user while reading

**Why it was a bug.** The effect `useEffect(() => { bottomRef.current?.scrollIntoView(...) }, [messages])` fired on every message mutation, including streaming text deltas. If a user scrolled up to read earlier content, each incoming token yanked them back to the bottom. The scroll-to-bottom button added in the previous round surfaced the problem but did not solve it because the forced scroll overrode the user's intent.

**How it was fixed.** The effect now reads the message list's scroll position before deciding whether to scroll. It only scrolls to the bottom when the user is already within 160px of the bottom (a common threshold used by chat apps). If the user has deliberately scrolled up, their position is preserved and the sticky scroll-to-bottom button provides an escape hatch.

```tsx
useEffect(() => {
  const el = messageListRef.current;
  if (!el) { bottomRef.current?.scrollIntoView(...); return; }
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  if (distanceFromBottom < 160) {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }
}, [messages]);
```

Required moving the list's DOM ref up to the App component so both the effect and the inner `MessageList` component share it.

### 2. Locale change overwrites real assistant replies

**Why it was a bug.** `changeLocale` replaced `messages[0].content` with the new locale's intro string whenever the first message was an assistant message. After loading a saved session where `messages[0]` was a real assistant reply, switching languages silently corrupted that message with the intro text — data loss.

**How it was fixed.** The replacement now only fires when the first assistant message's content matches the previous locale's untouched intro string. Any customised or real assistant content is left alone.

```tsx
const previousIntro = TRANSLATIONS[previousLocale].assistantIntro;
setMessages((current) =>
  current.map((message, index) => {
    if (index !== 0 || message.role !== "assistant") return message;
    if (message.content.trim() !== previousIntro.trim()) return message;
    return { ...message, content: TRANSLATIONS[nextLocale].assistantIntro };
  }),
);
```

### 3. Enter key behavior contradicted standard chat UX

**Why it was a bug.** The textarea submitted on `Cmd/Ctrl+Enter` and treated plain `Enter` as a newline. Every modern chat UI (ChatGPT, Claude, Slack, Discord, Messenger) does the opposite: `Enter` sends, `Shift+Enter` is a newline. First-time users sat staring at the send button wondering why pressing Enter did nothing.

**How it was fixed.** Swapped the bindings. Also added an `isComposing` check so users composing CJK text with an IME (common for the `zh-TW` and `ja` locales this app supports) are not interrupted mid-composition.

```tsx
if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
  event.preventDefault();
  form?.requestSubmit();
}
```

### 4. No retry for failed assistant messages

**Why it was a bug.** When a stream errored, the status pill turned red and an error message was appended to the assistant bubble. The user's only recourse was to retype the entire prompt. For long financial analysis prompts in Chinese, this was painful.

**How it was fixed.**
1. Added an `errored?: boolean` flag to the `Message` interface.
2. Set the flag on any assistant message whose stream throws or emits an `error` event.
3. Added a visual treatment — red-tinted border, red role label — so errored messages are obvious.
4. Added a `retryMessage` function that removes the failed message plus its preceding user message, clears associated events, and re-submits the original prompt (preserving the original workflow).
5. Surfaced a retry button in the message's hover action toolbar.

---

## Medium-severity UX issues

### 5. Tutorial never auto-shows for first-time users

**Why it was a bug.** The code stored a `TUTORIAL_STORAGE_KEY` on dismissal but no code path ever read it to enable the tutorial. New users never saw the onboarding unless they happened to click the Guide button — which doesn't stand out.

**How it was fixed.** On mount, the app checks localStorage and auto-opens the tutorial when the key is absent.

```tsx
if (!localStorage.getItem(TUTORIAL_STORAGE_KEY)) {
  setShowTutorial(true);
}
```

### 6. Status pill stuck on "Complete" or "Error"

**Why it was a bug.** After a run finished, the pill stayed at "Complete" (or "Error") forever until the next run. Showing a green checkmark with the word "Complete" when the system is actually idle is misleading.

**How it was fixed.** Added a dedicated effect that transitions the pill back to "Ready" four seconds after landing on `complete` or `error`. Streams in progress cancel the pending transition automatically.

### 7. Voice input notice never dismissed

**Why it was a bug.** When voice recognition failed or was unavailable, the message stayed in the composer footer indefinitely. The user had to reload the page to clear it.

**How it was fixed.** Added a four-second auto-dismiss timer for `voiceMessage`. Clears on next change.

### 8. API key inline message was redundant with toast

**Why it was a bug.** The previous round introduced toast notifications. The pre-existing inline `apiKeyMessage` duplicated the confirmation and, like the voice notice, never cleared.

**How it was fixed.** Added a five-second auto-dismiss. The toast provides primary feedback, and the inline hint acts as a brief reminder.

### 9. Compass icon for API settings was unintuitive

**Why it was a bug.** A compass conveys navigation and discovery, not credentials. Users translating the app to Chinese and Japanese kept referring to "the compass button" in docs — the icon and the concept didn't match.

**How it was fixed.** Replaced `<Compass>` with `<KeyRound>` from the Lucide set. Added an attention state: when no API key is configured, the button pulses gently with the accent color and shows a small dot in the corner. Translation strings in all three locales were updated to say "key button" instead of "compass button".

### 10. Mobile skill drawer had no backdrop

**Why it was a bug.** Below 980px the skill workbench became a fixed bottom overlay. There was no backdrop to dismiss it — only a small close button. Users opening the drawer by accident were stuck tapping a tiny X.

**How it was fixed.** Added a `.side-panel-backdrop` div that renders only when the drawer is open and only on small screens (via CSS media query). Clicking anywhere outside the drawer closes it.

### 11. No navigation in image lightbox

**Why it was a bug.** When a message produced multiple generated visualizations, users had to close the lightbox and click a thumbnail for each image they wanted to view at full size.

**How it was fixed.** The lightbox now accepts a `gallery` array. Prev/Next circular buttons appear overlaid on the image when the gallery has more than one item, plus a counter showing position. Arrow Left/Right keyboard shortcuts work alongside Escape.

### 12. Tool output JSON was rendered as one giant line

**Why it was a bug.** The `summarize` helper pretty-printed non-string values but passed strings through unchanged. When the backend sent a tool output as a JSON string (common for MCP tools), it rendered as one unwrapped, unreadable line.

**How it was fixed.** The helper now detects JSON-shaped strings (starting with `{` or `[`, ending with the mirror) and attempts to pretty-print them. If parsing fails, it falls back to the original string. Also added `white-space: pre-wrap; word-break: break-word;` on `.event-card code` so anything long wraps properly.

### 13. Skill draft generation silently overwrote user input

**Why it was a bug.** In the Skill Editor Modal, clicking "Generate draft" called the backend and replaced the current name/description/instructions with the AI output. If the user had spent time typing custom instructions, one click destroyed their work.

**How it was fixed.** Added a confirm dialog (localized) when existing content is detected. The user can cancel and keep their draft.

---

## Low-severity polish

### 14. Toast timers never cleaned up on unmount

**Why it was a bug.** `showToast` created a `setTimeout` but didn't track or cancel it if the component unmounted. For a single-page app this is low impact, but it's still a leak and bad practice.

**How it was fixed.** Switched to a `Map<string, number>` ref that tracks timer ids. A cleanup effect clears all pending timers on unmount.

### 15. Raw role labels ("user", "assistant") rendered

**Why it was a bug.** Role labels displayed the raw enum value via CSS uppercase. For screen readers that converts to "USER" or "ASSISTANT" — not a branding win, and not obvious to non-technical users.

**How it was fixed.** Added `roleYou` / `roleAssistant` translation keys in all three locales ("You" / "Assistant", "你" / "助理", "あなた" / "アシスタント"). The bubble now renders the localized role label. Removed the forced uppercase CSS so the text matches the translation casing.

---

## Files changed

- `frontend/src/main.tsx` — logic fixes, new props, new translations, new icons
- `frontend/src/styles.css` — errored message styles, lightbox nav, API key attention state, side-panel backdrop, event code wrapping
- `docs/UI_UX_FIXES_2026_05_10.md` — this document

## Verification

```
cd frontend
npm run build
```

Produces a successful build with no TypeScript diagnostics. No new runtime dependencies were added.

## Follow-up items not yet addressed

These were flagged in the review but deferred as lower impact or requiring larger refactors:

- **Event log text density.** Consider a collapsible "raw detail" section with a preview line.
- **Session switch race condition.** Brief empty-state flash when rapidly toggling sessions. Fix would require a loading sentinel on the Activity Rail.
- **Virtualized message list.** Only needed once chats regularly exceed a few hundred messages.
- **Mobile Event History tab icon.** The `Brain` icon is more intuitive than the previous options but a labelled bottom nav would be clearer on tiny screens.
- **Chat title truncation.** `slice(0, 72)` can split surrogate pairs. Use `Intl.Segmenter` for grapheme-aware truncation in a future pass.

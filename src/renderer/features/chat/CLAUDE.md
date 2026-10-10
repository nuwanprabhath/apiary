# src/renderer/features/chat: the chat transcript's parts

Read with root CLAUDE.md. The path of a chat across main and renderer is in
[`docs/architecture/chat.md`](../../../../docs/architecture/chat.md). This folder draws the
conversation as the VS Code extension does; it holds no chat state of its own.

## What lives here

- `ChatTimeline.tsx`: the conversation, the pinned latest prompt, thinking rows, queued messages.
- `ToolCall.tsx`: one tool call (status dot, IN box, OUT box). `PermissionCard.tsx`: Claude asking
  to use a tool, in the conversation.
- `ModeMenu.tsx` (permission mode), `ModelPicker.tsx` (model, effort scale, context ring),
  `CommandPalette.tsx` (the "/" menu), `usePopover.ts` (open and close for those three).
- `WorkingLine.tsx` (the line under the conversation while Claude works), `ChatStatus.tsx` (background
  tasks, last turn, recap), `useCopyOnSelect.ts`.

The message box itself is `features/transcript/Composer.tsx`; the pure merge of streamed and
persisted messages is `src/shared/chatTimeline.ts`.

## The sanctioned way

- **Read the chat with `useChat(sessionId)`** from `src/renderer/state/chatStore.ts`. Never call
  `window.apiary.chat*` from a component (`bridge-via-state`); the store attaches the session to
  this window when the first reader arrives and detaches with the last.
- **Act on a chat with the commands in `chatStore.ts`** (`interruptChat`, `answerChatRequest`,
  `setChatModel`, ...). They follow the error policy in
  [`src/renderer/state/CLAUDE.md`](../../state/CLAUDE.md). The composer awaits `startChat` and
  `sendChat` so a failure keeps its text.
- **A menu or list uses the `ui/` primitives** (`Menu`, `Listbox`, `Popover`) for roles and keys; do
  not write `role="menu"` here (`roles-via-primitives`).
- **Hiding tool calls is a filter before the draw**, not a flag on `ToolCall`: `withoutToolCalls`
  runs in `Transcript`, and `useChatSettings` (`state/chatSettingsStore.ts`) reads the per-chat
  setting that overrides the global default. Do not add a second "hidden" path inside the rows.
- **New chat data** starts in `ChatState` (`src/shared/domain/chat.ts`) and the reducer in
  `src/main/chat/protocol.ts`; then draw it here.

## Tests

- `tests/component/transcriptChat.test.tsx`: the whole chat UI against `fakeApiary.ts` (keyboard and
  focus of the menus, effort scale, command palette).
- `tests/component/copyOnSelect.test.tsx`, `tests/component/messageRowMemo.test.tsx`.
- `tests/unit/chatTimeline.test.ts` for the pure merge; `tests/e2e/transcriptChat.spec.ts` for the
  real app with `tests/fixtures/fake-claude-chat.mjs`.

## Pitfalls

- **A background tab shows no chat and gets no pushes.** It fetches `chatState` when it becomes the
  active tab. Anything that must hear about every chat uses `onChatLifecycle`, not `useChat`.
- **A streaming chat pushes about 25 times a second.** Keep rows memoised and read only your
  session's key; a selector must return a stable value.
- **A queued message shows once.** Claude writes a taken-in message to the file before it confirms,
  so `stillQueued` hides a queued entry once your message has reached the transcript. **Send now**
  (`sendChatNow`) writes the message at once when Claude is idle; when busy, main stops the turn and
  writes it at that turn's `result` (`src/main/CLAUDE.md`). Either way the row goes when Claude echoes
  the message back.
- **Selecting text must not open a clipped box.** A click that ends a selection is not a request to
  expand; the tool boxes are not buttons so their text stays selectable.
- **Thinking text is often absent.** Claude Code keeps only a signature, so a thinking row may say
  only that Claude thought, and for how long.
- **The message box takes a terminal over only when it is idle.** A busy terminal (mid-turn, or with
  background tasks) gets the message typed into it.
- **A mode or model chosen before the chat runs is the start option**, not a command.

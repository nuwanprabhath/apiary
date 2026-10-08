# ADR-0015: Chat state goes only to the windows that show it; lifecycle goes to all

- **Status:** Accepted
- **Context:** `chatChanged` carried the full `ChatState` to every window about every 40 ms while a
  reply streamed, so a window showing something else was woken for a conversation it did not show.
  Ptys already solved this with per-window attachments.
- **Decision:** A renderer attaches the session its pane shows (`chatAttach`, sent by
  `state/chatStore.ts` when a key gets its first reader) and detaches with the last reader
  (`chatDetach`). `ChatService` sends `chatChanged` through `WindowAttachments` to attached windows
  only, plus those still on the session a `/clear` left. The small, rare `chatLifecycle` event (a chat
  started, moved onto a new session, or ended) goes to every window, because a tab in a background pane
  must still drop its dead terminal or follow a chat that moved.
- **Alternatives tried:** Broadcasting every state to every window: the cost above. Only the
  lifecycle event, with no state push: a visible pane would have no live stream.
- **Consequences:** A background tab receives no stream and fetches `chatState` when it becomes the
  active tab. An exited chat is dropped from `ChatManager` once no window shows it, so its error text
  is gone if a tab opens later; while a window shows it, the last state stays. Anything that must hear
  about every chat uses `onChatLifecycle`, not `useChat`.
- **Enforced by:** `tests/unit/chatService.test.ts` (delivery, `/clear`, pruning),
  `tests/unit/windowAttachments.test.ts`, the clauses in `tests/contract/clauses/chat.ts`
  (attach, detach, state only to an attached window, lifecycle to all, against the fake and real main), and the `/clear` case in
  `tests/e2e/transcriptChat.spec.ts`. The ESLint rule `send-through-windows` keeps raw
  `webContents.send` out of services.

See [`docs/architecture/chat.md`](../architecture/chat.md).

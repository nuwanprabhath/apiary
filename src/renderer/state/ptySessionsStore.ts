import type { PtySessionInfo } from '@shared/api'
import { createIpcStore } from './createIpcStore'

/** pty id → the Claude session its process is on now, kept live — see claudeSessionTracker.ts. */
const ptySessionsStore = createIpcStore<Record<string, PtySessionInfo>>({
  scope: 'session-tracker',
  initial: {},
  fetch: () => window.apiary.ptySessions(),
  subscribe: (push) => window.apiary.onPtySessionsChanged(push),
})

/** The same, as last read, without subscribing: for a gesture, not for drawing. */
export function peekPtySessions(): Record<string, PtySessionInfo> {
  return ptySessionsStore.getSnapshot()
}

export function usePtySessions(): Record<string, PtySessionInfo> {
  return ptySessionsStore.useStore()
}

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import type { ChatDecision } from '@shared/domain/chat'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import type { ResidentPermissionRequest } from '@shared/domain/residents'
import type { DeskParts } from '../../../src/main/desk/desk'
import type { SessionEvent } from '../../../src/main/driving/sessionDriver'
import { SlackBridge, type SlackInbound } from '../../../src/main/slack/slackBridge'
import { SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

/** A real bridge over the fake Slack, a fake driver and a fake residents service; handlers are driven directly. */
export async function deskWorld() {
  const slack = fakeSlack()
  const store = new SlackStore(join(mkdtempSync(join(tmpdir(), 'apiary-desk-')), 'slack.json'), memoryCipher())
  const bridge = new SlackBridge({ store, api: slack })
  await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: false })
  const driverListeners = new Set<(e: SessionEvent) => void>()
  const permListeners = new Set<(id: string, r: ResidentPermissionRequest[]) => void>()
  const answers: { sessionId: string; requestId: string; decision: ChatDecision }[] = []
  const residentAnswers: { id: string; requestId: string; allow: boolean }[] = []
  const interrupted: string[] = []
  const stopped: string[] = []
  const states = new Map<string, { title: string; status: string; since: number | null }>()
  const driver = {
    onEvent: (l: (e: SessionEvent) => void) => { driverListeners.add(l); return () => { driverListeners.delete(l) } },
    answer: (sessionId: string, requestId: string, decision: ChatDecision) => { answers.push({ sessionId, requestId, decision }) },
    interrupt: (id: string) => { interrupted.push(id) },
    stateOf: (id: string) => states.get(id) ?? { title: id, status: 'unknown', since: null },
  }
  const residents = {
    onPermissions: (l: (id: string, r: ResidentPermissionRequest[]) => void) => { permListeners.add(l); return () => { permListeners.delete(l) } },
    answerPermission: (id: string, requestId: string, allow: boolean) => { residentAnswers.push({ id, requestId, allow }) },
    stop: (id: string) => { stopped.push(id) },
    names: () => [{ id: 'r1', name: 'Regent', kindId: 'regent', state: 'idle', setupNeeded: null }],
  }
  const parts = { bridge, driver, residents } as unknown as DeskParts
  const handlers: { order: number; fn: (m: SlackInbound) => boolean | Promise<boolean> }[] = []
  const realHandle = bridge.handle.bind(bridge)
  vi.spyOn(bridge, 'handle').mockImplementation((order, fn) => { handlers.push({ order, fn }); return realHandle(order, fn) })
  return {
    slack, bridge, parts, answers, residentAnswers, interrupted, stopped, states,
    sid: (s: string): SessionId => asSessionId(s),
    emit: (e: SessionEvent) => { for (const l of [...driverListeners]) l(e) },
    residentRequests: (id: string, r: ResidentPermissionRequest[]) => { for (const l of [...permListeners]) l(id, r) },
    /** The owner's message: opens the task for a top-level one, then asks the handlers in order. */
    async say(thread: string, text: string, kind: 'task' | 'reply' = 'reply'): Promise<boolean> {
      const ts = slack.ownerSays(text, kind === 'reply' ? { thread } : {})
      if (kind === 'task') bridge.tasks.open(ts, text)
      const at = kind === 'task' ? ts : thread
      for (const h of [...handlers].sort((a, b) => a.order - b.order)) if (await h.fn({ thread: at, ts, text, kind })) return true
      return false
    },
  }
}

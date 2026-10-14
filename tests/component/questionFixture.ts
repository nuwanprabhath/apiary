import { page, userEvent } from 'vitest/browser'
import { expect } from 'vitest'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { emptyChatState, type ChatPermissionRequest, type ChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'

const TITLE = 'Fix CSV export bug'

/** The input of the AskUserQuestion call the maintainer reported (a long question, three options). */
export const NAMES_INPUT = {
  questions: [{
    question: "How should fauna common names work, given that AFD's 'Preferred' name is sometimes odd (Luaner for Eastern Quoll, Dingo for Canis familiaris)?",
    header: 'Common names',
    options: [
      { label: 'All names, one row (Recommended)', description: 'One row per taxon. Keep every AFD common name in a searchable commonNames list so any name finds the animal. IDs stay unique.' },
      { label: 'One row per name', description: 'Like the old list: a separate dropdown row for each common name. It shows several rows for one animal.' },
      { label: 'Preferred name only', description: "Keep what's built now: one common name per taxon. A name AFD does not prefer won't resolve." },
    ],
    multiSelect: false,
  }],
}

export function ask(input: unknown, requestId = 'q1', toolName = 'AskUserQuestion'): ChatPermissionRequest {
  return { requestId, toolName, description: '', input, canAlwaysAllow: false }
}

export async function openChat(): Promise<{ fake: FakeApiary; sessionId: string }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  return { fake, sessionId: fake.state.sessions.find((s) => s.title === TITLE)!.sessionId }
}

export function play(fake: FakeApiary, sessionId: string, patch: Partial<ChatState>): void {
  const next = { ...(fake.state.chats.get(sessionId) ?? { ...emptyChatState(asSessionId(sessionId)), status: 'idle' as const }), ...patch }
  fake.state.chats.set(sessionId, next)
  fake.emit('chatChanged', next)
}

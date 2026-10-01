import { defineBridgeContract, LONG_SESSION } from '../contract/bridgeContract'
import { createFakeApiary, FIXTURE_SESSIONS, message, type FakeSession } from './fakeApiary'

// The fake against the shared behavioural spec; the real main process runs the same spec in
// tests/integration/contract.test.ts (TEST-5).
defineBridgeContract('fakeApiary', async ({ imported = true, longSessionMessages }) => {
  const sessions: FakeSession[] = [...FIXTURE_SESSIONS]
  if (longSessionMessages !== undefined) {
    const messages = [message('u1', 'user', 'fix the export')]
    for (let i = 0; i < longSessionMessages - 2; i++) messages.push(message(`a${String(i)}`, 'assistant', `pad-${String(i)}`))
    messages.push(message('last', 'assistant', 'done'))
    sessions.push({ sessionId: LONG_SESSION.id, title: LONG_SESSION.title, projectPath: '/fixture/work-a', gitBranch: 'main', messages })
  }
  const api = createFakeApiary({ sessions, imported: imported ? 'all' : 'none' })
  return Promise.resolve({ api, folders: { workA: '/fixture/work-a', workB: '/fixture/work-b' }, cleanup: () => {} })
})

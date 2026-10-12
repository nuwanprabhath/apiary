import { describe, it } from 'vitest'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi } from './review'

/**
 * The sidebar drawn from main's library state (what a remote window gets from the work machine):
 * a group, a pinned session, and a long group name in a narrow sidebar.
 */
async function openSidebar(groupName: string): Promise<void> {
  const { fake } = await renderApp({
    library: {
      groups: [{ id: 'work', name: groupName }],
      groupAssignments: { '/fixture/work-a': 'work' },
      pinned: [],
    },
  })
  const pinned = fake.state.sessions.find((s) => s.title === 'Worktree session')?.sessionId
  if (pinned !== undefined) {
    fake.state.library = { ...fake.state.library, state: { ...fake.state.library.state, pinned: [pinned] } }
    fake.emit('libraryStateChanged', fake.state.library)
  }
  await until(() => document.querySelector('[data-testid="pinned-section"]') !== null)
  await until(() => document.querySelector('[data-testid="folder-group"]') !== null)
}

describe('UI: the sidebar from library state', () => {
  it('library sidebar with a group and a pin', async () => {
    await openSidebar('Work')
    await reviewUi('library sidebar with a group and a pin', { widths: [900, 1400] })
  })

  it('library sidebar with a long group name', async () => {
    await openSidebar('Everything for the quarterly reporting pipeline at work')
    await reviewUi('library sidebar with a long group name', { widths: [900] })
  })
})

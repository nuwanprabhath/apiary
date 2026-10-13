import { beforeEach, describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { emptyChatState } from '@shared/domain/chat'
import { asSessionId } from '@shared/domain/ids'
import { reviewUi } from './review'

const TITLE = 'Fix CSV export bug'
const LONG = 'Please look at the CSV exporter and explain why quoted commas break the column count, then fix it and add a regression test for it'

async function open(): Promise<{ busy: () => void }> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  await userEvent.click(sidebarSession(TITLE))
  await until(() => document.querySelector('[data-testid="composer"]') !== null)
  const sessionId = fake.state.sessions.find((s) => s.title === TITLE)!.sessionId
  return {
    busy: () => {
      const next = { ...emptyChatState(asSessionId(sessionId)), status: 'busy' as const }
      fake.state.chats.set(sessionId, next)
      fake.emit('chatChanged', next)
    },
  }
}

/** The audit looks at the composer only: the pane header above it is another package's. */
const scoped = (opts: NonNullable<Parameters<typeof reviewUi>[1]>): NonNullable<Parameters<typeof reviewUi>[1]> =>
  ({ ...opts, within: () => document.querySelector('[data-testid="composer"]') })

const fold = async (): Promise<void> => {
  await userEvent.click(page.getByTestId('composer-collapse'))
  await until(() => document.querySelector('[data-testid="composer-input"]') === null)
}

describe('UI composer collapse', () => {
  beforeEach(() => { localStorage.removeItem('apiary.ui') })

  it('composer expanded', async () => {
    await open()
    await reviewUi('composer expanded', scoped({ widths: [620, 1000] }))
  })

  it('composer collapsed empty', async () => {
    await open()
    await fold()
    await reviewUi('composer collapsed empty', scoped({ widths: [620, 1000], themes: ['default', 'paper', 'glass'] }))
  })

  it('composer collapsed with a long draft', async () => {
    await open()
    await userEvent.fill(page.getByTestId('composer-input'), LONG)
    await fold()
    await reviewUi('composer collapsed draft', scoped({ widths: [620, 1000] }))
  })

  it('composer collapsed busy', async () => {
    const { busy } = await open()
    await fold()
    busy()
    await until(() => document.querySelector('[data-testid="composer-stop"]') !== null)
    await reviewUi('composer collapsed busy', scoped({ widths: [620, 1000] }))
  })

  it('two panes, the first folded and the second open', async () => {
    await open()
    await userEvent.click(page.getByTestId('session-tab-split').first())
    await until(() => document.querySelectorAll('[data-testid="composer"]').length === 2)
    await userEvent.click(page.getByTestId('composer-collapse').first())
    await until(() => document.querySelectorAll('[data-testid="composer-input"]').length === 1)
    await reviewUi('composer two panes one folded', { widths: [1000] })
  })

  it('composer collapsed narrow', async () => {
    await open()
    await userEvent.fill(page.getByTestId('composer-input'), LONG)
    await fold()
    await reviewUi('composer collapsed narrow', scoped({ widths: [620] }))
  })
})

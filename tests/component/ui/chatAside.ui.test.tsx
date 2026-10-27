import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { mouse, sidebarSession, until } from '../helpers'
import { reviewUi } from './review'
import type { FakeApiary } from '../fakeApiary'

/** Side questions (`/btw`) over the message box: just opened, answering, a thread of two, and failed. */
const TITLE = 'Fix CSV export bug'
const ANSWER = '`mergeLive` appends the live messages the file has not caught up with yet:\n\n- it anchors on the last live message the file has\n- with none in common, only newer ones are added\n\nSo nothing is shown twice.'

async function asked(answer: (fake: FakeApiary) => void, question = 'what does mergeLive do, in a sentence or two, and why does it anchor on the last live message?'): Promise<void> {
  const { fake } = await renderApp({ settings: { transcriptChat: true } })
  answer(fake)
  await userEvent.click(sidebarSession(TITLE))
  await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
  await userEvent.fill(page.getByTestId('composer-input'), question === '' ? '/btw' : `/btw ${question}`)
  await userEvent.keyboard('{Enter}')
  await until(() => document.querySelector('[data-testid="chat-aside"]') !== null)
  await mouse.move(1, 1)
  await until(() => document.querySelector('.hover-card') === null)
}

const turnStatus = (): string | null => document.querySelector('[data-testid="chat-aside-turn"]:last-child')?.getAttribute('data-status') ?? null

describe('UI side question', () => {
  it('just opened, with nothing asked yet', async () => {
    await asked(() => {}, '')
    await reviewUi('side question empty', { widths: [1000] })
  })

  it('answering', async () => {
    await asked((fake) => { fake.override('chatAside', () => new Promise<string>(() => {})) })
    await reviewUi('side question answering', { widths: [1000] })
  })

  it('answered', async () => {
    await asked((fake) => { fake.override('chatAside', async () => ANSWER) })
    await until(() => turnStatus() === 'answered')
    await userEvent.fill(page.getByTestId('chat-aside-input'), 'and when are there none in common?')
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelectorAll('[data-testid="chat-aside-turn"][data-status="answered"]').length === 2)
    await reviewUi('side question thread', { widths: [1000, 1400] })
  })

  it('failed', async () => {
    await asked((fake) => { fake.override('chatAside', async () => { throw new Error('Claude could not be run (exit 1). Not logged in.') }) })
    await until(() => turnStatus() === 'failed')
    await reviewUi('side question failed', { widths: [1000] })
  })
})

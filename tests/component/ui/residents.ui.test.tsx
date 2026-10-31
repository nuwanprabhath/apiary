import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import type { SessionHit } from '@shared/domain/residents'
import { STANDARD_SESSIONS } from '../../fixtures/standard'
import { writeResidentPopupRect } from '../../../src/renderer/state/uiState'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { message, mrDeskStatus, regentStatus, withMrDesk, withRegent } from '../residentFixtures'
import { reviewUi } from './review'

const bar = (): Element | null => document.querySelector('[data-testid="status-bar"]')
const popup = (): Element | null => document.querySelector('[data-testid="resident-popup"]')
const badge = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="resident-badge-regent"]')!

async function openPopup(): Promise<void> {
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(badge())
  await until(() => popup() !== null)
}

const HITS: SessionHit[] = [
  { sessionId: STANDARD_SESSIONS.csv.id, title: 'Fix CSV export bug', folder: 'work-a', branch: 'fix/csv-export-empty-rows', lastActive: Date.now(), reason: 'ref', topic: null, snippet: '!1175' },
  { sessionId: STANDARD_SESSIONS.switcher.id, title: 'Add worktree switcher', folder: 'work-b', branch: null, lastActive: Date.now(), reason: 'topic', topic: 'API interface design', snippet: null },
  { sessionId: STANDARD_SESSIONS.repoRoot.id, title: 'Repo root session', folder: 'repo-c', branch: 'main', lastActive: Date.now(), reason: 'text', topic: null, snippet: null },
]

describe('the resident in the status bar', () => {
  it('asleep', async () => {
    await renderApp({}, (f) => { withRegent(f, { enabled: false }) })
    await until(() => badge().dataset.state === 'asleep')
    await reviewUi('resident badge asleep', { widths: [620, 1000], within: bar })
  })

  it('idle, with an unread answer', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge().dataset.state === 'idle')
    fake.emit('residentMessage', { residentId: 'regent', message: message('assistant', 'The digest is done.') })
    await until(() => badge().querySelector('.resident-unread') !== null)
    await reviewUi('resident badge idle unread', { widths: [620, 1000], within: bar })
  })

  it('working, with a long activity', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await until(() => badge().dataset.state === 'idle')
    fake.emit('residentsChanged', [regentStatus('working', 'Searching sessions for the API interface design discussion')])
    await until(() => badge().dataset.state === 'working')
    await reviewUi('resident badge working', { widths: [620, 1000], within: bar })
  })
})

const deskBadge = (): HTMLElement => document.querySelector<HTMLElement>('[data-testid="resident-badge-mr-desk"]')!
const DESK_ACTIONS = { quickActions: [{ id: 'desk', label: 'Show the desk' }, { id: 'stats', label: 'Show stats' }] }

describe('the MR desk in the status bar', () => {
  it('honey pot idle', async () => {
    await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null && deskBadge().dataset.state === 'idle')
    await reviewUi('resident honeypot idle', { widths: [620, 1000], within: bar })
  })

  it('honey pot working, with a pill', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    fake.emit('residentsChanged', [mrDeskStatus('working', { activity: 'Reading !1175 review threads' })])
    await until(() => deskBadge().dataset.state === 'working')
    await reviewUi('resident honeypot working', { widths: [620, 1000], within: bar })
  })

  it('honey pot needing you: count and summary', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', { attention: { count: 3, summary: '3 MRs wait for your review' } })])
    await until(() => deskBadge().dataset.needs === 'true')
    await reviewUi('resident honeypot needs you', { widths: [620, 1000], within: bar })
  })

  it('Regent and the MR desk side by side', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f); withMrDesk(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    fake.emit('residentsChanged', [regentStatus('idle'), mrDeskStatus('idle', { permissions: [{ requestId: 'r', tool: 'Bash', summary: 'Run: glab mr list' }] })])
    await until(() => deskBadge().dataset.needs === 'true')
    await reviewUi('residents side by side', { widths: [620, 1000], within: bar })
  })

  it('the right-click menu open', async () => {
    const { fake } = await renderApp({}, (f) => { withMrDesk(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-mr-desk"]') !== null)
    fake.emit('residentsChanged', [mrDeskStatus('idle', DESK_ACTIONS)])
    await until(() => deskBadge().dataset.state === 'idle')
    const r = deskBadge().getBoundingClientRect()
    deskBadge().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }))
    await until(() => document.querySelector('[data-testid="resident-menu"]') !== null)
    await reviewUi('resident right-click menu', { widths: [620, 1000] })
  })
})

describe('the resident chat popup', () => {
  it('two permission requests', async () => {
    await renderApp({}, (f) => {
      withRegent(f, { history: [message('user', 'Which MRs need me?'), message('assistant', 'Let me check GitLab.')] })
      f.state.residentPermissions.set('regent', [
        { requestId: 'r1', tool: 'Bash', summary: 'Run: glab mr list --reviewer=@me --state=opened --per-page=50 --output=json' },
        { requestId: 'r2', tool: 'Edit', summary: 'Edit notes.md' },
      ])
    })
    await openPopup()
    await until(() => popup()?.querySelectorAll('[data-testid="resident-permission"]').length === 2)
    await reviewUi('resident popup permissions', { widths: [620, 1000], within: popup })
  })

  it('the setup banner', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await openPopup()
    fake.emit('residentsChanged', [{ ...regentStatus('idle'), setupNeeded: 'Set the GitLab project and the local clone in Settings' }])
    await until(() => popup()?.querySelector('[data-testid="resident-setup"]') !== null)
    await reviewUi('resident popup setup banner', { widths: [620, 1000], within: popup })
  })

  it('a wide table from a command', async () => {
    const head = '| MR | Title | Author | Pipeline | Approvals | Updated |'
    const rule = '| --- | --- | --- | --- | --- | --- |'
    const row = '| !1175 | Fix CSV export for empty rows in the report | alice | passed | 1 of 2 | 2 hours ago |'
    await renderApp({}, (f) => { withRegent(f, { history: [message('assistant', `${head}\n${rule}\n${row}\n${row}`)] }) })
    await openPopup()
    await until(() => popup()?.querySelector('.resident-msg-assistant table') !== null)
    await reviewUi('resident popup wide table', { widths: [620, 1000], within: popup })
  })

  it('a conversation with chips and match cards', async () => {
    const { fake } = await renderApp({}, (f) => {
      withRegent(f, {
        history: [
          message('user', 'Where did we discuss the API interface design?'),
          message('assistant', `Mostly in [the switcher work](apiary://session/${STANDARD_SESSIONS.switcher.id}), and a little in [CSV](apiary://session/${STANDARD_SESSIONS.csv.id}).\n\n- the **request** shape\n- error codes`),
        ],
      })
    })
    await openPopup()
    fake.override('residentSend', async (id: string, text: string) => {
      fake.emit('residentMessage', { residentId: id, message: message('user', text) })
      fake.emit('residentMessage', { residentId: id, message: message('assistant', '', true) })
      fake.emit('residentsChanged', [regentStatus('working', 'Searching sessions…')])
      return HITS
    })
    await userEvent.fill(document.querySelector<HTMLTextAreaElement>('.resident-popup-input')!, 'Open the session for !1175')
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelectorAll('[data-testid="resident-hit"]').length === 3)
    await reviewUi('resident popup conversation', { widths: [620, 1000, 1400], within: popup })
  })

  it('empty', async () => {
    await renderApp({}, (f) => { withRegent(f) })
    await openPopup()
    await until(() => popup()?.querySelector('.resident-empty') !== null)
    await reviewUi('resident popup empty', { widths: [620, 1000], within: popup })
  })

  it('disabled', async () => {
    await renderApp({}, (f) => { withRegent(f, { enabled: false }) })
    await openPopup()
    await reviewUi('resident popup disabled', { widths: [620, 1000], within: popup })
  })

  it('at its minimum size', async () => {
    writeResidentPopupRect({ right: 12, bottom: 30, width: 100, height: 100 })
    await renderApp({}, (f) => {
      withRegent(f, { history: [message('user', 'What auth did we design between core and wildobs?'), message('assistant', 'Token exchange over mTLS; see the **core** auth notes.')] })
    })
    await openPopup()
    await reviewUi('resident popup minimum size', { widths: [620, 1000], within: popup })
  })
})

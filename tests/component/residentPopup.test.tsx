import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { SessionHit } from '@shared/domain/residents'
import { STANDARD_SESSIONS } from '../fixtures/standard'
import { renderApp } from './renderApp'
import { drag, stays, until } from './helpers'
import { message, regentStatus, withRegent } from './residentFixtures'
import type { FakeApiary } from './fakeApiary'

const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const input = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>('.resident-popup-input')!
const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]

async function openPopup(arrange: (fake: FakeApiary) => void = (f) => { withRegent(f) }): Promise<FakeApiary> {
  const { fake } = await renderApp({}, arrange)
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup() !== null)
  return fake
}

const HIT: SessionHit = {
  sessionId: STANDARD_SESSIONS.csv.id, title: 'Fix CSV export bug', folder: '/Users/someone/projects/work', branch: 'main',
  lastActive: Date.now(), reason: 'ref', topic: null, snippet: '!1175',
}

describe('the resident popup', () => {
  it('history renders', async () => {
    await openPopup((f) => { withRegent(f, { history: [message('user', 'Where is the CSV work?'), message('assistant', 'In **two** sessions.')] }) })
    await until(() => popup()!.textContent.includes('Where is the CSV work?'))
    expect(popup()!.querySelector('.resident-msg-assistant strong')?.textContent).toBe('two')
  })

  it('Enter sends, Shift+Enter adds a newline', async () => {
    const fake = await openPopup()
    await until(() => document.activeElement === input())
    await userEvent.keyboard('first{Shift>}{Enter}{/Shift}second')
    expect(input().value).toBe('first\nsecond')
    expect(fake.callsTo('residentSend')).toHaveLength(0)
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('residentSend').length === 1)
    expect(fake.callsTo('residentSend')[0]).toEqual(['regent', 'first\nsecond'])
    await until(() => input().value === '')
  })

  it('instant hits render under the message and open the session', async () => {
    const fake = await openPopup()
    fake.override('residentSend', async (id: string, text: string) => {
      fake.emit('residentMessage', { residentId: id, message: message('user', text) })
      return [HIT]
    })
    await userEvent.fill(input(), 'Open the session for !1175')
    await userEvent.keyboard('{Enter}')
    await until(() => document.querySelector('[data-testid="resident-hit"]') !== null)
    const hit = document.querySelector<HTMLElement>('[data-testid="resident-hit"]')!
    expect(hit.textContent).toContain('Fix CSV export bug')
    // The folder by its own name, as the sidebar shows it; the whole path only on hover.
    expect(hit.querySelector('.resident-hit-where')?.textContent).toBe('work · main')
    expect(hit.querySelector<HTMLElement>('.resident-hit-where')?.title).toBe('/Users/someone/projects/work')
    expect(hit.textContent).toContain('!1175')
    expect(popup()!.textContent).toContain('Possible matches')
    await userEvent.click(hit)
    await until(() => tabs().some((t) => t.textContent.includes('Fix CSV export bug')))
  })

  it('a session link renders as a chip that opens the session', async () => {
    await openPopup((f) => {
      withRegent(f, { history: [message('assistant', `It is [this one](apiary://session/${STANDARD_SESSIONS.csv.id}).`)] })
    })
    await until(() => document.querySelector('[data-testid="resident-session-chip"]') !== null)
    const chip = document.querySelector<HTMLElement>('[data-testid="resident-session-chip"]')!
    expect(chip.textContent).toContain('Fix CSV export bug')
    await userEvent.click(chip)
    await until(() => tabs().some((t) => t.textContent.includes('Fix CSV export bug')))
  })

  it('Escape and an outside click do not close it; X does', async () => {
    await openPopup()
    await userEvent.keyboard('{Escape}')
    await userEvent.click(document.querySelector('[data-testid="sidebar"]')!, { position: { x: 20, y: 200 } })
    await stays(() => popup() !== null, 200, 'the popup stays open')
    await userEvent.click(document.querySelector('[data-testid="resident-popup-close"]')!)
    await until(() => popup() === null)
    expect(popup()).toBeNull()
  })

  it('the moved and resized rect persists and is clamped into the window', async () => {
    await page.viewport(1200, 820)
    await openPopup()
    const before = popup()!.getBoundingClientRect()
    await drag(document.querySelector('.resident-popup-header')!, -200, -100)
    await until(() => popup()!.getBoundingClientRect().left < before.left - 150)
    await drag(document.querySelector('[data-testid="resident-popup-resize-left"]')!, -60, 0)
    await until(() => popup()!.getBoundingClientRect().width > before.width + 40)
    const moved = popup()!.getBoundingClientRect()
    await userEvent.click(document.querySelector('[data-testid="resident-popup-close"]')!)
    await until(() => popup() === null)
    await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
    await until(() => popup() !== null)
    const again = popup()!.getBoundingClientRect()
    expect(Math.round(again.left)).toBe(Math.round(moved.left))
    expect(Math.round(again.width)).toBe(Math.round(moved.width))
    await page.viewport(700, 600)
    await until(() => {
      const r = popup()!.getBoundingClientRect()
      return r.left >= 0 && r.top >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight
    })
    expect(popup()!.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth)
  })

  it('disabled shows Enable in Settings', async () => {
    await openPopup((f) => { withRegent(f, { enabled: false }) })
    await until(() => popup()!.textContent.includes('Regent is off.'))
    await userEvent.click(page.getByRole('button', { name: 'Enable in Settings' }))
    // Settings has no Residents section until package D3 adds one; the dialog opening is the wiring.
    await expect.element(page.getByTestId('settings-nav-general')).toBeVisible()
  })

  it('permission requests show oldest first; Allow and Deny answer, and the card leaves', async () => {
    const fake = await openPopup((f) => {
      withRegent(f)
      f.state.residentPermissions.set('regent', [
        { requestId: 'r1', tool: 'Bash', summary: 'Run: glab mr list' },
        { requestId: 'r2', tool: 'Edit', summary: 'Edit notes.md' },
      ])
    })
    const cards = (): HTMLElement[] => [...popup()!.querySelectorAll<HTMLElement>('[data-testid="resident-permission"]')]
    await until(() => cards().length === 2)
    expect(cards()[0].textContent).toContain('Bash')
    expect(cards()[0].textContent).toContain('Run: glab mr list')
    expect(cards()[0].querySelector('strong')!.textContent).toBe('Bash')
    await userEvent.click(cards()[0].querySelector('[data-testid="resident-permission-allow"]')!)
    await until(() => cards().length === 1)
    expect(fake.callsTo('residentPermissionAnswer')[0]).toEqual(['regent', 'r1', true])
    await userEvent.click(cards()[0].querySelector('[data-testid="resident-permission-deny"]')!)
    await until(() => cards().length === 0)
    expect(fake.callsTo('residentPermissionAnswer')[1]).toEqual(['regent', 'r2', false])
  })

  it('setupNeeded shows a banner that opens Settings', async () => {
    const fake = await openPopup()
    fake.emit('residentsChanged', [{ ...regentStatus('idle'), setupNeeded: 'Set the GitLab project in Settings' }])
    await until(() => popup()!.querySelector('[data-testid="resident-setup"]') !== null)
    expect(popup()!.querySelector('[data-testid="resident-setup"]')!.textContent).toContain('Set the GitLab project in Settings')
    await userEvent.click(page.getByTestId('resident-setup-open'))
    await expect.element(page.getByTestId('residents-section')).toBeVisible()
  })

  it('a wide table scrolls inside its bubble, so the popup keeps its width', async () => {
    const row = `| ${Array.from({ length: 14 }, (_, i) => `column-number-${String(i)}`).join(' | ')} |`
    const rule = `|${' --- |'.repeat(14)}`
    await openPopup((f) => { withRegent(f, { history: [message('assistant', `${row}\n${rule}\n${row}`)] }) })
    await until(() => popup()!.querySelector('.resident-msg-assistant table') !== null)
    const before = popup()!.getBoundingClientRect().width
    const table = popup()!.querySelector<HTMLElement>('.resident-msg-assistant table')!
    const bubble = popup()!.querySelector<HTMLElement>('.resident-msg-assistant')!
    expect(table.scrollWidth).toBeGreaterThan(table.clientWidth)
    expect(table.getBoundingClientRect().right).toBeLessThanOrEqual(bubble.getBoundingClientRect().right + 0.5)
    expect(popup()!.getBoundingClientRect().width).toBe(before)
    const body = popup()!.querySelector<HTMLElement>('.resident-popup-body')!
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth)
  })

  it('while working, the last row is a working line with the busy animation and the activity, streaming or not', async () => {
    const fake = await openPopup((f) => { withRegent(f, { history: [message('user', 'Run one MR desk cycle.')] }) })
    const line = (): HTMLElement | null => popup()!.querySelector('[data-testid="resident-working"]')
    expect(line()).toBeNull()
    fake.emit('residentsChanged', [regentStatus('working', 'Running mra prompt 1559')])
    await until(() => line() !== null)
    expect(line()!.textContent).toBe('Running mra prompt 1559')
    expect(line()!.querySelector('.busy-glyph')).not.toBeNull()
    const body = popup()!.querySelector('.resident-popup-body')!
    expect(body.lastElementChild).toBe(line())
    fake.emit('residentMessage', { residentId: 'regent', message: message('assistant', 'Reviewing', true) })
    await until(() => popup()!.textContent.includes('Reviewing'))
    expect(body.lastElementChild).toBe(line())
    expect(popup()!.querySelector('.resident-popup-title')!.textContent).toContain('Running mra prompt 1559')
    fake.emit('residentsChanged', [regentStatus('idle')])
    await until(() => line() === null)
  })

  it('Stop shows only while working', async () => {
    const fake = await openPopup()
    const stop = (): Element | null => popup()!.querySelector('[data-testid="resident-popup-stop"]')
    expect(stop()).toBeNull()
    fake.emit('residentsChanged', [regentStatus('working', 'Searching sessions')])
    await until(() => stop() !== null)
    await userEvent.click(stop()!)
    await until(() => fake.callsTo('residentStop').length === 1)
    fake.emit('residentsChanged', [regentStatus('idle')])
    await until(() => stop() === null)
  })
})

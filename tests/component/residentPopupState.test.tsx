import { describe, it, expect, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { createFakeApiary } from './fakeApiary'
import { until } from './helpers'
import {
  closeResidentPopup, openResidentPopup, takeResidentAsk, toggleResidentPopup, useResidentPopup,
} from '../../src/renderer/state/residentPopup'

/**
 * Which resident's popup this window shows: the badge and ⌘⇧Space toggle it, only its X closes it,
 * and a question handed over by the search box is sent once.
 */
let root: Root | null = null
afterEach(() => { root?.unmount(); root = null; document.body.replaceChildren() })

function Probe() {
  const { openId } = useResidentPopup()
  return <p data-testid="open">{openId ?? 'none'}</p>
}

function mount(): HTMLElement {
  window.apiary = createFakeApiary()
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  root.render(<Probe />)
  return host
}

const shown = (host: HTMLElement): string => host.querySelector('[data-testid="open"]')?.textContent ?? ''
const shows = (host: HTMLElement, id: string): Promise<void> => until(() => shown(host) === id)

describe('resident popup state', () => {
  it('toggle opens a resident, toggling it again closes it, and toggling another switches', async () => {
    const host = mount()
    await shows(host, 'none')
    toggleResidentPopup('regent')
    await shows(host, 'regent')
    toggleResidentPopup('regent')
    await shows(host, 'none')
    toggleResidentPopup('regent')
    toggleResidentPopup('scout')
    await shows(host, 'scout')
    closeResidentPopup()
    await shows(host, 'none')
    expect(shown(host)).toBe('none')
  })

  it('a question handed over on open is taken once, and only by its resident', async () => {
    const host = mount()
    openResidentPopup('regent', '  open the session for !1175 ')
    await shows(host, 'regent')
    expect(takeResidentAsk('scout')).toBeNull()
    expect(takeResidentAsk('regent')).toBe('open the session for !1175')
    expect(takeResidentAsk('regent')).toBeNull()
  })

  it('an empty question opens the popup with nothing to send', () => {
    mount()
    openResidentPopup('regent', '   ')
    expect(takeResidentAsk('regent')).toBeNull()
  })
})

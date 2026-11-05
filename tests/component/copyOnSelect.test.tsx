/** Copy-on-select for the transcript: mouseup copies a selection; the right-click menu has Copy. */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { useRef } from 'react'
import { createFakeApiary, type FakeApiary } from './fakeApiary'
import { stays } from './helpers'
import { NotificationProvider } from '../../src/renderer/ui/notifications'
import { NotificationCenter } from '../../src/renderer/ui/NotificationCenter'
import { useCopyOnSelect } from '../../src/renderer/features/chat/useCopyOnSelect'

function Probe(): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const { onContextMenu, menu } = useCopyOnSelect(ref)
  return (
    <div>
      <div ref={ref} data-testid="region" onContextMenu={onContextMenu}>
        <p id="para">hello transcript world</p>
        <div className="markdown text-block" style={{ color: 'white' }}>
          <p>Hi Sam,</p>
          <ul id="list">
            <li id="first">First <strong>point</strong></li>
            <li id="second">Second point<div className="code-block"><button type="button" className="code-copy">Copy</button></div></li>
          </ul>
        </div>
        <input id="field" defaultValue="typed text" />
      </div>
      <p id="outside">outside text</p>
      {menu}
    </div>
  )
}

let cleanup: (() => void) | null = null
afterEach(() => { cleanup?.(); cleanup = null; window.getSelection()?.removeAllRanges() })

async function mount(): Promise<FakeApiary> {
  const fake = createFakeApiary()
  window.apiary = fake
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(<NotificationProvider><Probe /><NotificationCenter /></NotificationProvider>)
  cleanup = () => { root.unmount(); host.remove() }
  await expect.poll(() => document.getElementById('para')).not.toBeNull()
  return fake
}

function select(id: string): void {
  const range = document.createRange()
  range.selectNodeContents(document.getElementById(id)!)
  const sel = window.getSelection()!
  sel.removeAllRanges()
  sel.addRange(range)
}

function mouseup(id: string): void {
  document.getElementById(id)!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
}

describe('useCopyOnSelect', () => {
  it('copies the selection on mouseup and says how much', async () => {
    const fake = await mount()
    select('para')
    mouseup('para')
    await expect.poll(() => fake.callsTo('copyToClipboard')).toEqual([['hello transcript world']])
    await expect.poll(() => document.querySelector('[data-testid="notification-message"]')?.textContent)
      .toBe('Copied 22 chars to clipboard')
  })

  it('ignores a selection outside the element and a bare click', async () => {
    const fake = await mount()
    select('outside')
    mouseup('para')
    window.getSelection()!.removeAllRanges()
    mouseup('para')
    await stays(() => fake.callsTo('copyToClipboard').length === 0, 50, 'nothing to be copied')
  })

  it('ignores mouseup inside an input', async () => {
    const fake = await mount()
    select('para')
    mouseup('field')
    await stays(() => fake.callsTo('copyToClipboard').length === 0, 50, 'nothing to be copied')
  })

  it('right-click menu: Copy is enabled with a selection and copies it', async () => {
    const fake = await mount()
    select('para')
    document.getElementById('para')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
    await expect.poll(() => document.querySelector('[data-testid="context-menu-copy"]')).not.toBeNull()
    const item = document.querySelector<HTMLButtonElement>('[data-testid="context-menu-copy"]')!
    expect(item.disabled).toBe(false)
    item.click()
    await expect.poll(() => fake.callsTo('copyToClipboard')).toEqual([['hello transcript world']])
  })

  it('right-click menu: Copy is disabled with no selection', async () => {
    await mount()
    document.getElementById('para')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
    await expect.poll(() => document.querySelector('[data-testid="context-menu-copy"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[data-testid="context-menu-copy"]')!.disabled).toBe(true)
  })
})

describe('Copy with formatting', () => {
  /** Selects from the start of `fromId`'s text to the end of `toId`'s. */
  function selectAcross(fromId: string, toId: string): void {
    const range = document.createRange()
    range.setStart(document.getElementById(fromId)!.firstChild!, 0)
    range.setEndAfter(document.getElementById(toId)!.lastChild!)
    const sel = window.getSelection()!
    sel.removeAllRanges()
    sel.addRange(range)
  }

  it('copies a selection inside a list as that list, as HTML and as text, without the app\'s classes, styles or buttons', async () => {
    await mount()
    const written: ClipboardItem[][] = []
    const write = vi.spyOn(navigator.clipboard, 'write').mockImplementation(async (items) => { written.push([...items]) })
    try {
      selectAcross('first', 'second')
      document.getElementById('first')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
      await expect.poll(() => document.querySelector('[data-testid="context-menu-copy-formatted"]')).not.toBeNull()
      document.querySelector<HTMLButtonElement>('[data-testid="context-menu-copy-formatted"]')!.click()
      await expect.poll(() => written.length).toBe(1)
      const [item] = written[0]
      const html = await (await item.getType('text/html')).text()
      const text = await (await item.getType('text/plain')).text()
      expect(html).toBe('<ul><li>First <strong>point</strong></li><li>Second point</li></ul>')
      expect(text).toContain('First point')
      expect(text).toContain('Second point')
      await expect.poll(() => document.querySelector('[data-testid="notification-message"]')?.textContent).toBe('Copied with formatting')
    } finally {
      write.mockRestore()
    }
  })

  it('is disabled with no selection', async () => {
    await mount()
    document.getElementById('para')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 }))
    await expect.poll(() => document.querySelector('[data-testid="context-menu-copy-formatted"]')).not.toBeNull()
    expect(document.querySelector<HTMLButtonElement>('[data-testid="context-menu-copy-formatted"]')!.disabled).toBe(true)
  })
})

describe('copyText failures', () => {
  it('a refused clipboard write is shown, not swallowed', async () => {
    const fake = await mount()
    fake.override('copyToClipboard', () => Promise.reject(new Error('clipboard busy')))
    select('para')
    mouseup('para')
    await expect.poll(() => document.querySelector('[data-testid="notification-message"]')?.textContent)
      .toBe('Could not copy: clipboard busy')
  })
})

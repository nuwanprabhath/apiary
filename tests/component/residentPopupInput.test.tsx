import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { message, regentStatus, withRegent } from './residentFixtures'
import type { FakeApiary } from './fakeApiary'

const popup = (): HTMLElement | null => document.querySelector('[data-testid="resident-popup"]')
const input = (): HTMLTextAreaElement => document.querySelector<HTMLTextAreaElement>('.resident-popup-input')!

async function openPopup(arrange: (fake: FakeApiary) => void = (f) => { withRegent(f) }): Promise<FakeApiary> {
  const { fake } = await renderApp({}, arrange)
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup() !== null)
  return fake
}

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const pasteInto = (el: Element): void => {
  const bytes = Uint8Array.from(atob(TINY_PNG), (c) => c.charCodeAt(0))
  const dt = new DataTransfer()
  dt.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }))
  el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
}

describe('the resident popup: focus, images and copy', () => {
  it('a new message or status change never pulls focus from another text box', async () => {
    const fake = await openPopup()
    await until(() => document.activeElement === input())
    const other = document.createElement('textarea')
    document.body.append(other)
    other.focus()
    await userEvent.keyboard('abc')
    fake.emit('residentMessage', { residentId: 'regent', message: message('assistant', 'hello') })
    fake.emit('residentsChanged', [regentStatus('working', 'Reading')])
    await until(() => popup()!.textContent.includes('hello'))
    await userEvent.keyboard('def')
    expect(document.activeElement).toBe(other)
    expect(other.value).toBe('abcdef')
    expect(input().value).toBe('')
    other.remove()
  })

  it('a pasted image shows above the box, can be removed, and is sent as its path', async () => {
    const fake = await openPopup()
    expect(input().placeholder).toContain('paste an image')
    pasteInto(input())
    await until(() => popup()!.querySelector('[data-testid="composer-attachment"]') !== null)
    await userEvent.click(popup()!.querySelector('[data-testid="composer-attachment-remove"]')!)
    expect(popup()!.querySelector('[data-testid="composer-attachment"]')).toBeNull()
    pasteInto(input())
    await until(() => popup()!.querySelector('[data-testid="composer-attachment"]') !== null)
    await userEvent.fill(input(), 'what is this')
    await userEvent.keyboard('{Enter}')
    await until(() => fake.callsTo('residentSend').length === 1)
    expect(fake.callsTo('residentSend')[0][1]).toMatch(/^what is this\n\/fixture\/images\/pasted-\d+\.png$/)
    await until(() => popup()!.querySelector('[data-testid="composer-attachment"]') === null)
  })

  it('selecting text in the conversation copies it, and right-click offers Copy', async () => {
    await openPopup((f) => { withRegent(f, { history: [message('assistant', 'Select this sentence')] }) })
    await until(() => popup()!.textContent.includes('Select this sentence'))
    const el = popup()!.querySelector('.resident-msg-assistant')!
    window.getSelection()!.selectAllChildren(el)
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }))
    await until(() => document.body.textContent.includes('Copied'))
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 50 }))
    await until(() => document.querySelector('[data-testid="copy-menu"]') !== null)
    expect(document.querySelector('[data-testid="copy-menu"]')).not.toBeNull()
  })
})

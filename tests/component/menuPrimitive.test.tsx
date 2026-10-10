import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { Menu } from '../../src/renderer/ui/Menu'
import { useEscape } from '../../src/renderer/ui/useEscape'
import { mountUi } from './mountUi'

function Demo(): React.JSX.Element {
  const [open, setOpen] = useState(false)
  useEscape(() => { setOpen(false) }, { enabled: open })
  return (
    <div>
      <button data-testid="trigger" onClick={() => { setOpen(!open) }}>open</button>
      {open && (
        <Menu testId="menu">
          <button role="menuitem" data-testid="first">first</button>
          <button role="menuitemradio" aria-checked="true" data-testid="radio">radio</button>
          <button role="menuitem" disabled data-testid="off">disabled</button>
          <button role="menuitemcheckbox" aria-checked="false" data-testid="last">last</button>
        </Menu>
      )}
    </div>
  )
}

const focused = (): string | null => document.activeElement?.getAttribute('data-testid') ?? null

describe('Menu', () => {
  it('always carries the popup surface, with or without a class of its own, and never shows list bullets', async () => {
    await mountUi(
      <div>
        <Menu testId="bare" as="ul"><li role="none"><button role="menuitem">a</button></li></Menu>
        <Menu testId="classed" className="mine"><button role="menuitem">b</button></Menu>
      </div>,
    )
    const bare = page.getByTestId('bare').element()
    expect(bare.classList.contains('context-menu')).toBe(true)
    expect(getComputedStyle(bare).listStyleType).toBe('none')
    expect(getComputedStyle(bare).backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    const classed = page.getByTestId('classed').element()
    expect(classed.classList.contains('context-menu')).toBe(true)
    expect(classed.classList.contains('mine')).toBe(true)
  })

  it('takes focus on open, steps with the arrows over radios too, wraps, skips disabled, and Home/End jump', async () => {
    await mountUi(<Demo />)
    await userEvent.click(page.getByTestId('trigger'))
    expect(page.getByTestId('menu').element().getAttribute('role')).toBe('menu')
    expect(focused()).toBe('first')

    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('radio')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('last')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('first')
    await userEvent.keyboard('{ArrowUp}')
    expect(focused()).toBe('last')
    await userEvent.keyboard('{Home}')
    expect(focused()).toBe('first')
    await userEvent.keyboard('{End}')
    expect(focused()).toBe('last')
  })

  it('Escape closes it and focus returns to the control that opened it', async () => {
    await mountUi(<Demo />)
    await userEvent.click(page.getByTestId('trigger'))
    expect(focused()).toBe('first')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('menu')).not.toBeInTheDocument()
    expect(focused()).toBe('trigger')
  })

  it('a key the owner handles itself (preventDefault) does not also move the focus', async () => {
    function Owner(): React.JSX.Element {
      return (
        <Menu testId="menu" onKeyDown={(e) => { if (e.key === 'ArrowDown') e.preventDefault() }}>
          <button role="menuitem" data-testid="a">a</button>
          <button role="menuitem" data-testid="b">b</button>
        </Menu>
      )
    }
    await mountUi(<Owner />)
    expect(focused()).toBe('a')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('a')
    await userEvent.keyboard('{ArrowUp}')
    expect(focused()).toBe('b')
  })
})

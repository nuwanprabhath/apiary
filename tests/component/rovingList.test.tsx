import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useRef } from 'react'
import { nextIndex, useRovingList } from '../../src/renderer/ui/useRovingList'
import { mountUi } from './mountUi'

function Demo({ wrap, typeahead }: { wrap?: boolean; typeahead?: boolean }): React.JSX.Element {
  const list = useRef<HTMLUListElement | null>(null)
  const { onKeyDown } = useRovingList(list, { itemSelector: '.row', wrap, typeahead })
  return (
    <div>
      <input data-testid="search" onKeyDown={onKeyDown} />
      <ul ref={list} onKeyDown={onKeyDown}>
        {['apple', 'banana', 'blueberry', 'cherry'].map((name) => (
          <li key={name}><button className="row" data-testid={name} disabled={name === 'blueberry'}>{name}</button></li>
        ))}
      </ul>
    </div>
  )
}

const focused = (): string | null => document.activeElement?.getAttribute('data-testid') ?? null

describe('nextIndex', () => {
  it('enters at the first row going down and at the last going up when nothing is current', () => {
    expect(nextIndex('ArrowDown', -1, 3, false)).toBe(0)
    expect(nextIndex('ArrowUp', -1, 3, false)).toBe(2)
  })
  it('stops at the ends, or wraps', () => {
    expect(nextIndex('ArrowDown', 2, 3, false)).toBe(2)
    expect(nextIndex('ArrowUp', 0, 3, false)).toBe(0)
    expect(nextIndex('ArrowDown', 2, 3, true)).toBe(0)
    expect(nextIndex('ArrowUp', 0, 3, true)).toBe(2)
  })
  it('ignores other keys and empty lists', () => {
    expect(nextIndex('a', 0, 3, false)).toBeNull()
    expect(nextIndex('ArrowDown', -1, 0, false)).toBeNull()
  })
})

describe('useRovingList', () => {
  it('ArrowDown from the search box enters the list; arrows, Home and End move focus, skipping disabled rows', async () => {
    await mountUi(<Demo />)
    await userEvent.click(page.getByTestId('search'))
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('apple')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('banana')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('cherry')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('cherry')
    await userEvent.keyboard('{Home}')
    expect(focused()).toBe('apple')
    await userEvent.keyboard('{End}')
    expect(focused()).toBe('cherry')
  })

  it('wraps past the ends when asked', async () => {
    await mountUi(<Demo wrap />)
    await userEvent.click(page.getByTestId('apple'))
    await userEvent.keyboard('{ArrowUp}')
    expect(focused()).toBe('cherry')
    await userEvent.keyboard('{ArrowDown}')
    expect(focused()).toBe('apple')
  })

  it('typeahead jumps to the next row starting with the typed letter, only when enabled', async () => {
    await mountUi(<Demo typeahead />)
    await userEvent.click(page.getByTestId('apple'))
    await userEvent.keyboard('c')
    expect(focused()).toBe('cherry')

    await mountUi(<Demo />)
    const [, second] = document.querySelectorAll<HTMLElement>('[data-testid="apple"]')
    second.focus()
    await userEvent.keyboard('c')
    expect(document.activeElement).toBe(second)
  })
})

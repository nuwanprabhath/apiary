import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { useState } from 'react'
import { Listbox, optionId, useListboxNav } from '../../src/renderer/ui/Listbox'
import { mountUi } from './mountUi'

function Demo({ chosen }: { chosen: string[] }): React.JSX.Element {
  const [active, setActive] = useState(0)
  const items = ['alpha', 'beta', 'gamma']
  const { onKeyDown } = useListboxNav({ count: items.length, active, setActive, onChoose: () => { chosen.push(items[active]) } })
  return (
    <div>
      <input
        data-testid="search"
        role="combobox"
        aria-expanded="true"
        aria-controls="demo-list"
        aria-activedescendant={optionId('demo-list', active)}
        onKeyDown={onKeyDown}
      />
      <Listbox id="demo-list" label="Things" testId="list">
        {items.map((name, i) => (
          <div key={name} id={optionId('demo-list', i)} role="option" aria-selected={i === active} data-testid={`o-${name}`}>{name}</div>
        ))}
      </Listbox>
    </div>
  )
}

const activeOf = (): string | null => page.getByTestId('search').element().getAttribute('aria-activedescendant')

describe('Listbox', () => {
  it('is a named listbox whose options are followed with aria-activedescendant while focus stays in the input', async () => {
    await mountUi(<Demo chosen={[]} />)
    const list = page.getByTestId('list').element()
    expect(list.getAttribute('role')).toBe('listbox')
    expect(list.getAttribute('aria-label')).toBe('Things')
    await userEvent.click(page.getByTestId('search'))
    expect(activeOf()).toBe(optionId('demo-list', 0))
    expect(page.getByTestId('o-alpha').element().getAttribute('aria-selected')).toBe('true')

    await userEvent.keyboard('{ArrowDown}')
    expect(activeOf()).toBe(optionId('demo-list', 1))
    expect(page.getByTestId('o-beta').element().getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(page.getByTestId('search').element())
  })

  it('stops at both ends instead of wrapping, and Enter chooses the current option', async () => {
    const chosen: string[] = []
    await mountUi(<Demo chosen={chosen} />)
    await userEvent.click(page.getByTestId('search'))
    await userEvent.keyboard('{ArrowUp}')
    expect(activeOf()).toBe(optionId('demo-list', 0))
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(activeOf()).toBe(optionId('demo-list', 2))
    await userEvent.keyboard('{Enter}')
    expect(chosen).toEqual(['gamma'])
  })

  it('leaves Home and End to the input (they move its caret) unless asked', async () => {
    await mountUi(<Demo chosen={[]} />)
    await userEvent.click(page.getByTestId('search'))
    await userEvent.keyboard('{ArrowDown}{End}')
    expect(activeOf()).toBe(optionId('demo-list', 1))
  })
})

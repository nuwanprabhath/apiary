import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { mountUi } from './mountUi'
import { OverflowToolbar, type OverflowToolbarItem } from '../../src/renderer/ui/OverflowToolbar'
import { until } from './helpers'

describe('OverflowToolbar', () => {
  const createItems = (count: number): OverflowToolbarItem[] => {
    const items: OverflowToolbarItem[] = []
    for (let i = 0; i < count; i++) {
      items.push({
        id: `item-${i}`,
        icon: <span data-testid={`icon-${i}`}>🔧</span>,
        label: `Item ${i}`,
        title: `Item ${i}`,
        testId: `item-${i}`,
        disabled: false,
        onClick: () => {},
        priority: i < 2 ? i + 1 : 50 + i,
      })
    }
    return items
  }

  it('renders items', async () => {
    const items = createItems(3)
    await mountUi(
      <div style={{ width: '500px' }}>
        <OverflowToolbar items={items} />
      </div>
    )

    for (const item of items) {
      const button = document.querySelector(`[data-testid="${item.testId}"]`)
      expect(button).not.toBeNull()
    }
  })

  it('opens overflow menu when button is clicked', async () => {
    const items = createItems(3)
    await mountUi(
      <div style={{ width: '200px' }}>
        <OverflowToolbar items={items} />
      </div>
    )

    const overflowButton = document.querySelector<HTMLElement>('[data-testid="overflow-menu-button"]')
    expect(overflowButton).not.toBeNull()
    expect(document.querySelector('[data-testid="overflow-menu"]')).toBeNull()
    await userEvent.click(overflowButton!)
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)
    expect(document.querySelector('[data-testid="overflow-menu"]')).not.toBeNull()
  })

  it('closes overflow menu on escape', async () => {
    const items = createItems(3)
    await mountUi(
      <div style={{ width: '200px' }}>
        <OverflowToolbar items={items} />
      </div>
    )

    const overflowButton = document.querySelector<HTMLElement>('[data-testid="overflow-menu-button"]')
    expect(overflowButton).not.toBeNull()
    await userEvent.click(overflowButton!)
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)

    await userEvent.keyboard('{Escape}')
    await until(() => document.querySelector('[data-testid="overflow-menu"]') === null)
    expect(document.querySelector('[data-testid="overflow-menu"]')).toBeNull()
  })

  it('closes overflow menu when item is clicked', async () => {
    const items = createItems(3)
    let clickedId: string | null = null
    const itemsWithClick = items.map((item) => ({
      ...item,
      onClick: () => {
        clickedId = item.id
      },
    }))

    await mountUi(
      <div style={{ width: '200px' }}>
        <OverflowToolbar items={itemsWithClick} />
      </div>
    )

    const overflowButton = document.querySelector<HTMLElement>('[data-testid="overflow-menu-button"]')
    expect(overflowButton).not.toBeNull()
    await userEvent.click(overflowButton!)
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)

    const menuItems = document.querySelectorAll('[data-testid="overflow-menu"] [role="menuitem"]')
    expect(menuItems.length).toBeGreaterThan(0)
    await userEvent.click(menuItems[0])
    await until(() => document.querySelector('[data-testid="overflow-menu"]') === null)
    expect(clickedId).not.toBeNull()
  })

  it('shows icon in overflow menu items', async () => {
    const items = createItems(3)
    await mountUi(
      <div style={{ width: '100px' }}>
        <OverflowToolbar items={items} />
      </div>
    )

    const overflowButton = document.querySelector<HTMLElement>('[data-testid="overflow-menu-button"]')
    expect(overflowButton).not.toBeNull()
    await userEvent.click(overflowButton!)
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)

    const menuItems = document.querySelectorAll('[data-testid="overflow-menu"] [role="menuitem"]')
    expect(menuItems.length).toBeGreaterThan(0)
    for (const item of menuItems) {
      const icon = item.querySelector('[data-testid^="icon-"]')
      expect(icon).not.toBeNull()
    }
  })

  it('respects disabled state in menu', async () => {
    const items: OverflowToolbarItem[] = [
      {
        id: 'enabled',
        icon: <span>✓</span>,
        title: 'Enabled',
        testId: 'enabled',
        disabled: false,
        onClick: () => {},
      },
      {
        id: 'disabled',
        icon: <span>✗</span>,
        title: 'Disabled',
        testId: 'disabled',
        disabled: true,
        onClick: () => {},
        priority: 100,
      },
    ]

    await mountUi(
      <div style={{ width: '50px' }}>
        <OverflowToolbar items={items} />
      </div>
    )

    const overflowButton = document.querySelector<HTMLElement>('[data-testid="overflow-menu-button"]')
    expect(overflowButton).not.toBeNull()
    await userEvent.click(overflowButton!)
    await until(() => document.querySelector('[data-testid="overflow-menu"]') !== null)

    const menuItems = [...document.querySelectorAll('[data-testid="overflow-menu"] [role="menuitem"]')]
    expect(menuItems.length).toBeGreaterThan(0)
    const disabledItem = menuItems.find((el) => el.textContent?.includes('Disabled'))
    expect(disabledItem).not.toBeUndefined()
    expect((disabledItem as HTMLButtonElement).disabled).toBe(true)
  })
})

import { describe, it, expect } from 'vitest'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import { applyTheme } from '../../src/renderer/theme/applyTheme'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { userEvent } from 'vitest/browser'

/**
 * The maintainer saw a dark vertical shade down the left of the pane beside the sidebar and none on the
 * pane beside it. The reading surface thinned towards its sides, so the moving glass showed through
 * there: over a bright part of the backdrop the thinning reads as a darker band growing inward, over a
 * dark part as nothing. A pane's left edge must paint the same as its middle, so no backdrop can make one.
 */
describe('glass reading surface', () => {
  it('paints one colour across its width, with no edge that thins to the backdrop', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => document.querySelector('.transcript') !== null)
    applyTheme(BUILTIN_THEMES.find((t) => t.id === 'builtin:glass')!.spec)
    const surface = getComputedStyle(document.querySelector('.transcript')!)
    expect(surface.backgroundImage).not.toContain('gradient')
    expect(surface.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  })
})

import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { mountUi } from './mountUi'
import { sidebarSession, until } from './helpers'

const tab = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="session-tab"]')

/** Every rule of the app's stylesheets that sits inside a `prefers-reduced-motion: reduce` block. */
function reducedMotionRules(): CSSStyleRule[] {
  const rules: CSSStyleRule[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    for (const rule of Array.from(sheet.cssRules)) {
      if (rule instanceof CSSMediaRule && rule.conditionText.includes('prefers-reduced-motion')) {
        for (const inner of Array.from(rule.cssRules)) if (inner instanceof CSSStyleRule) rules.push(inner)
      }
    }
  }
  return rules
}

describe('a working session is obvious', () => {
  it('a tab whose session is running says so, with a ring and a bar; an idle tab has neither', async () => {
    await renderApp({ settings: { transcriptChat: true } })
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await until(() => tab() !== null)
    expect(tab()?.dataset.activity).toBe('idle')
    expect(tab()?.querySelector('.session-tab-ring')).toBeNull()
    expect(tab()?.dataset.glow).toBeUndefined()
    await expect.element(page.getByTestId('chat-timeline')).toBeVisible()
    await userEvent.fill(page.getByTestId('composer-input'), 'run a background task')
    await userEvent.keyboard('{Enter}')
    await expect.poll(() => tab()?.dataset.activity, { timeout: 5000 }).toBe('running')
    expect(tab()?.querySelector('.session-tab-ring')).not.toBeNull()
    expect(tab()?.dataset.glow).toBe('running')
  })

  it('the running dot spins, the waiting dot keeps its pulse', async () => {
    await mountUi(<><span className="status-dot" data-status="running" /><span className="status-dot" data-status="waiting" /></>)
    const [running, waiting] = [...document.querySelectorAll<HTMLElement>('.status-dot')]
    expect(getComputedStyle(running).animationName).toBe('status-spin')
    expect(getComputedStyle(waiting).animationName).toBe('status-attention')
  })

  it('a running element\'s border glow travels; a waiting one holds still; both are rings', async () => {
    await mountUi(<>
      <div className="session-tab" data-glow="running"><span className="session-tab-ring" /></div>
      <div className="session-tab" data-glow="waiting" />
    </>)
    const [run, wait] = [...document.querySelectorAll<HTMLElement>('.session-tab')]
    expect(getComputedStyle(run.querySelector('.session-tab-ring') as HTMLElement).animationName).toBe('status-spin')
    expect(getComputedStyle(run, '::after').animationName).toBe('border-glow')
    expect(getComputedStyle(wait, '::after').animationName).toBe('none')
    expect(getComputedStyle(wait, '::after').position).toBe('absolute')
  })

  it('reduced motion stops the spin and the glow but leaves a static mark', () => {
    const rules = reducedMotionRules()
    const stops = (sel: string): boolean => rules.some((r) => r.selectorText.includes(sel) && r.style.animationName === 'none')
    expect(stops('.status-dot[data-status="running"]')).toBe(true)
    expect(stops('.session-tab-ring')).toBe(true)
    expect(stops('[data-glow="running"]::after')).toBe(true)
  })
})

import { describe, it, expect, afterEach } from 'vitest'
import { auditUi } from './ui/audit'

/** The audit's see-through-popup rule: it is about something drawn over the page, which a listbox
 *  laid out as a panel of its own (the shell's terminal list) is not. */
const TRANSLUCENT = 'background: rgba(26, 32, 56, 0.45); width: 120px; height: 40px;'

function mount(html: string): HTMLElement {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

const flagged = (host: HTMLElement): string[] =>
  auditUi(host).filter((v) => v.rule === 'see-through-popup').map((v) => v.where)

afterEach(() => { document.body.replaceChildren() })

describe('UI audit: see-through popups', () => {
  it('flags a translucent menu drawn over the page', () => {
    const host = mount(`<div role="menu" style="position: fixed; top: 0; left: 0; ${TRANSLUCENT}">Copy</div>`)
    expect(flagged(host)).toHaveLength(1)
  })

  it('flags a translucent listbox inside a floating wrapper', () => {
    const host = mount(`<div style="position: absolute; top: 0; left: 0;"><ul role="listbox" style="${TRANSLUCENT}"><li role="option">One</li></ul></div>`)
    expect(flagged(host)).toHaveLength(1)
  })

  it('flags anything marked data-popup, wherever it is laid out', () => {
    const host = mount(`<div data-popup="" style="${TRANSLUCENT}">Jump to latest</div>`)
    expect(flagged(host)).toHaveLength(1)
  })

  it('leaves alone a translucent listbox laid out as a panel', () => {
    const host = mount(`<ul role="listbox" style="${TRANSLUCENT}"><li role="option">Terminal 1</li></ul>`)
    expect(flagged(host)).toEqual([])
  })
})

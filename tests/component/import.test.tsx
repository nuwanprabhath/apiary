import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { FIXTURE_SESSIONS, type FakeApiary, type FakeSession } from './fakeApiary'
import { until, sidebarSession } from './helpers'

/** Opens the import dialog the way the menu does — a main-process event, in the fake. */
async function openImportDialog(fake: FakeApiary): Promise<void> {
  fake.emit('openImportDialog')
  await expect.element(page.getByTestId('import-dialog')).toBeVisible()
}

/** Every `import-group` section whose path text includes `path`, as raw elements. */
function groupsContaining(path: string): HTMLElement[] {
  return page.getByTestId('import-group').elements()
    .filter((el): el is HTMLElement => el.textContent?.includes(path) === true)
}

describe('the import dialog', () => {
  describe('default fixture (one session per group)', () => {
    it('lists every discovered session grouped by folder', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await until(() => page.getByTestId('import-group').elements().length === 4)
      await until(() => page.getByTestId('import-session-checkbox').elements().length === 4)
      // This one is the row inside the dialog, not the sidebar behind it.
      await expect.element(page.getByTestId('import-dialog').getByText('Fix CSV export bug')).toBeVisible()
    })

    it('imports only the ticked sessions', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.click(page.getByTestId('import-session-checkbox').all()[0])
      await userEvent.click(page.getByTestId('import-confirm'))

      await expect.element(page.getByTestId('import-dialog')).not.toBeInTheDocument()
      await until(() => page.getByTestId('session-item').elements().length === 1)
    })

    it('searching narrows the list', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.fill(page.getByTestId('import-search'), 'csv')
      await expect.poll(() => page.getByTestId('import-session-checkbox').elements().length).toBe(1)
    })

    it('cancelling imports nothing', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.click(page.getByTestId('import-session-checkbox').all()[0])
      await userEvent.click(page.getByTestId('import-cancel'))
      await expect.element(page.getByTestId('import-dialog')).not.toBeInTheDocument()
      await expect.element(page.getByTestId('sidebar-empty')).toBeVisible()
    })

    it('already-imported sessions come back ticked and disabled', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.click(page.getByTestId('import-session-checkbox').all()[0])
      await userEvent.click(page.getByTestId('import-confirm'))
      await until(() => page.getByTestId('session-item').elements().length === 1)

      await openImportDialog(fake)
      const first = page.getByTestId('import-session-checkbox').all()[0]
      await expect.element(first).toBeChecked()
      await expect.element(first).toBeDisabled()
    })
  })

  describe('folder with two sessions', () => {
    // Scoped to this describe block only, rather than added to the shared default fixture: the
    // default fixture's every group holds exactly one session, which is exactly what makes the
    // other tests in this file able to assert exact-count totals (4 groups, 4 checkboxes) without
    // those counts drifting for reasons unrelated to what each test covers. A second session in
    // "work-a" is needed only to prove that ticking a folder header selects *every* session in
    // that folder, not just one — so it is added only here, alongside the fixture's own four.
    const secondInWorkA: FakeSession = {
      sessionId: '77777777-7777-7777-7777-777777777777',
      title: 'Second session in work-a',
      projectPath: '/fixture/work-a',
    }

    it('ticking the folder header selects every session in it', async () => {
      const { fake } = await renderApp({ imported: 'none', sessions: [...FIXTURE_SESSIONS, secondInWorkA] })
      await openImportDialog(fake)

      const workAGroup = groupsContaining('/fixture/work-a')[0]
      const workBGroup = groupsContaining('/fixture/work-b')[0]

      // Sanity on the fixture shape itself: work-a now holds two sessions, work-b still one.
      expect(workAGroup.querySelectorAll('[data-testid="import-session-checkbox"]').length).toBe(2)
      expect(workBGroup.querySelectorAll('[data-testid="import-session-checkbox"]').length).toBe(1)

      const workAGroupCheckbox = workAGroup.querySelector('[data-testid="import-group-checkbox"]') as HTMLElement
      await userEvent.click(workAGroupCheckbox)

      // Both of work-a's sessions must now be checked...
      const workASessionCheckboxes = [...workAGroup.querySelectorAll<HTMLInputElement>('[data-testid="import-session-checkbox"]')]
      expect(workASessionCheckboxes[0].checked).toBe(true)
      expect(workASessionCheckboxes[1].checked).toBe(true)
      await expect.element(page.getByTestId('import-count')).toHaveTextContent('2')

      // ...while work-b, a different group, is untouched.
      const workBCheckbox = workBGroup.querySelector<HTMLInputElement>('[data-testid="import-session-checkbox"]')!
      expect(workBCheckbox.checked).toBe(false)

      await userEvent.click(page.getByTestId('import-confirm'))
      await expect.element(page.getByTestId('import-dialog')).not.toBeInTheDocument()

      // Both of work-a's sessions actually made it through the import, not just one of them.
      await expect.element(sidebarSession('Fix CSV export bug')).toBeVisible()
      await expect.element(sidebarSession('Second session in work-a')).toBeVisible()
      await until(() => page.getByTestId('session-item').elements().length === 2)
    })
  })

  describe('folder checkbox state', () => {
    it('a folder whose every session is already imported shows as checked, not unchecked', async () => {
      // The header used to count only the sessions ticked in *this* visit, so a folder that was
      // fully imported on a previous one came back with an unchecked box — which reads as "none of
      // this folder is in", when in fact all of it is.
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      const group = groupsContaining('/fixture/work-a')[0]
      await userEvent.click(group.querySelector('[data-testid="import-group-checkbox"]') as HTMLElement)
      await userEvent.click(page.getByTestId('import-confirm'))
      await until(() => page.getByTestId('session-item').elements().length === 1)

      await openImportDialog(fake)
      const again = groupsContaining('/fixture/work-a')[0]
      const againCheckbox = again.querySelector('[data-testid="import-group-checkbox"]') as HTMLElement
      await expect.element(againCheckbox).toBeChecked()
      // Still disabled — there is nothing left in it to change — but it now says so honestly.
      await expect.element(againCheckbox).toBeDisabled()
    })

    it('ticking every session in a folder one by one checks the folder itself', async () => {
      const secondInWorkA: FakeSession = {
        sessionId: '77777777-7777-7777-7777-777777777777',
        title: 'Second in work-a',
        projectPath: '/fixture/work-a',
      }
      const { fake } = await renderApp({ imported: 'none', sessions: [...FIXTURE_SESSIONS, secondInWorkA] })
      await openImportDialog(fake)
      const group = groupsContaining('/fixture/work-a')[0]
      const boxes = [...group.querySelectorAll<HTMLInputElement>('[data-testid="import-session-checkbox"]')]
      expect(boxes.length).toBe(2)

      const groupBox = group.querySelector<HTMLInputElement>('[data-testid="import-group-checkbox"]')!
      expect(groupBox.checked).toBe(false)

      await userEvent.click(boxes[0])
      // One of two: neither in nor out, and the box says so rather than claiming either.
      expect(groupBox.checked).toBe(false)
      expect(groupBox.indeterminate).toBe(true)

      await userEvent.click(boxes[1])
      expect(groupBox.checked).toBe(true)
      expect(groupBox.indeterminate).toBe(false)
    })

    // 'the scrollbar has arrow buttons that step by a line, not a page' stays in e2e: it clicks the
    // native `::-webkit-scrollbar-button` pseudo-elements, and synthetic mouse events in this
    // browser-mode harness reach the hover state (confirmed: `data-scrolling` activates and the
    // coordinates land inside the button's box) but do not register as a click on the native
    // scrollbar chrome itself, so `scrollTop` never moves. That is a property of automating native
    // scrollbar UI in this environment, not something the fake or a different arrangement fixes.
  })

  describe('dialog behaviour', () => {
    it('Escape closes the import dialog', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByTestId('import-dialog')).not.toBeInTheDocument()
    })

    it('one checkbox selects every session listed', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await expect.element(page.getByTestId('import-count')).toHaveTextContent('0 selected')

      await userEvent.click(page.getByTestId('import-select-all'))
      await expect.element(page.getByTestId('import-count')).toHaveTextContent('4 selected')
      const boxes = page.getByTestId('import-session-checkbox').all()
      await expect.element(boxes[0]).toBeChecked()
      await expect.element(boxes[3]).toBeChecked()

      // Unticking it puts everything back, rather than leaving a half-selected mess behind.
      await userEvent.click(page.getByTestId('import-select-all'))
      await expect.element(page.getByTestId('import-count')).toHaveTextContent('0 selected')
    })

    it('select-all follows the search, so it never quietly picks rows you filtered out', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      await userEvent.fill(page.getByTestId('import-search'), 'csv')
      await until(() => page.getByTestId('import-session-checkbox').elements().length === 1)

      await userEvent.click(page.getByTestId('import-select-all'))
      await expect.element(page.getByTestId('import-count')).toHaveTextContent('1 selected')
    })

    it('hovering a session shows its full name and how old it is', async () => {
      const { fake } = await renderApp({ imported: 'none' })
      await openImportDialog(fake)
      // The visible label is ellipsized to fit; the tooltip is where the whole thing lives, along
      // with the one other fact you need to tell two similar sessions apart.
      const row = [...document.querySelectorAll<HTMLElement>('.import-row')]
        .find((el) => el.textContent?.includes('Fix CSV export bug') === true)!
      const tip = row.getAttribute('title')
      expect(tip).toContain('Fix CSV export bug')
      expect(tip).toMatch(/Last active/i)
    })
  })
})

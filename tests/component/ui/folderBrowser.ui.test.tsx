import { afterEach, describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { BrowseView } from '@shared/domain/folders'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { reviewUi } from './review'

const WIDTHS = [620, 900, 1400]

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

/** Mounts as main opens a remote window (`remote=<host>` in the URL), after `arrange` has set up the fake. */
async function renderRemote(host: string, arrange: (fake: FakeApiary) => void = () => undefined): ReturnType<typeof renderApp> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=${host}`)
  const mounted = await renderApp({}, arrange)
  await makeGroup()
  return mounted
}

/** The sidebar's "New session in a folder…" is on a user group's "+": make a group, then press it. */
async function makeGroup(): Promise<void> {
  await until(() => document.querySelector('.project-row-wrap[data-depth="0"]') !== null)
  const first = document.querySelector('.project-row-wrap[data-depth="0"]')
  if (first === null) throw new Error('no project row')
  await rightClick(first)
  await userEvent.click(page.getByTestId('context-menu-new-group'))
  await userEvent.keyboard('{Enter}')
}

/** Presses the group's "+" (the group is made once, before the review opens this at each width). */
async function openFolderBrowser(): Promise<void> {
  await userEvent.click(page.getByTestId('group-new-session-button'))
  await until(() => document.querySelector('[data-testid="folder-browser"]') !== null)
  await until(() => document.querySelector('[data-testid="folder-loading"]') === null)
}

const close = async (): Promise<void> => { await userEvent.keyboard('{Escape}') }
afterEach(() => { history.replaceState(null, '', location.pathname) })

const view = (crumbs: string[], names: string[], repos: string[] = []): BrowseView => ({
  id: 'b1', crumbs, atRoot: crumbs.length === 1, entries: names.map((name) => ({ name, isRepo: repos.includes(name) })),
})

describe('UI: the folder browser', () => {
  it('folder browser at home', async () => {
    await renderRemote('work-box')
    await reviewUi('folder browser at home', {
      widths: WIDTHS,
      open: async () => {
        await openFolderBrowser()
        await userEvent.click(document.querySelectorAll<HTMLElement>('[data-testid="folder-row"]')[2] ?? document.body)
      },
      close,
    })
  })

  it('folder browser deep with a long path', async () => {
    const deep = ['~', 'projects', 'client-work', 'the-quarterly-reporting-pipeline', 'services', 'ingestion-gateway-with-a-very-long-name']
    const many = Array.from({ length: 30 }, (_, i) => `module-${String(i).padStart(2, '0')}-${i % 3 === 0 ? 'a-rather-long-folder-name-that-needs-the-room' : 'short'}`)
    await renderRemote('work-box.corp.example.com', (fake) => {
      fake.override('folderBrowseOpen', async () => view(deep, many, [many[1] ?? '', many[4] ?? '']))
    })
    await reviewUi('folder browser deep with a long path', {
      widths: WIDTHS,
      open: openFolderBrowser,
      close,
    })
  })

  it('folder browser empty folder', async () => {
    await renderRemote('work-box', (fake) => {
      fake.override('folderBrowseOpen', async () => view(['~', 'projects', 'empty'], []))
    })
    await reviewUi('folder browser empty folder', { widths: WIDTHS, open: openFolderBrowser, close })
  })

  it('folder browser error', async () => {
    await renderRemote('work-box', (fake) => {
      fake.override('folderBrowseEnter', async () => { throw new Error('That folder is outside your home folder, or is gone.') })
    })
    await reviewUi('folder browser error', {
      widths: WIDTHS,
      open: async () => {
        await openFolderBrowser()
        await userEvent.dblClick(document.querySelectorAll<HTMLElement>('[data-testid="folder-row"]')[1] ?? document.body)
        await until(() => document.querySelector('[data-testid="folder-error"]') !== null)
      },
      close,
    })
  })
})

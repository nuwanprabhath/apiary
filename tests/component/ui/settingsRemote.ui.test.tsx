import { afterEach, describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { StatusBarItem } from '@shared/domain/statusBar'
import { machinePayload } from '@shared/settings/schema'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { withRegent } from '../residentFixtures'
import { reviewUi } from './review'

const USAGE: StatusBarItem = {
  pluginId: 'claude-usage', id: 'usage', icon: 'gauge', text: '5h 64% (4:10 pm) · 7d 21%', title: 'Claude usage',
  tone: 'normal', action: { kind: 'panel' }, detail: [],
}

/** Mounts the app as a remote window onto `host`, whose settings say it serves remote access. */
async function renderRemote(host: string, arrange: (fake: FakeApiary) => void = () => undefined): Promise<FakeApiary> {
  history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=${host}`)
  const { fake } = await renderApp({ statusBar: [USAGE] }, (f) => {
    f.override('machineSettingsGet', async () => machinePayload({ ...f.state.settings, remoteAccess: true }))
    arrange(f)
  })
  return fake
}

async function openSettings(fake: FakeApiary, section: string): Promise<void> {
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId(`settings-nav-${section}`))
  await until(() => document.querySelector('[data-testid="settings-pane"] .settings-blurb') !== null)
}

afterEach(() => { history.replaceState(null, '', location.pathname) })

/** Settings and the status bar in a window showing a work machine. */
describe('UI: a remote window shows the work machine\'s settings and status bar', () => {
  it('settings on the work machine: Sessions, with the switch and the note', async () => {
    const fake = await renderRemote('nuwan-hp')
    await openSettings(fake, 'sessions')
    await reviewUi('settings remote host sessions', {})
  })

  it('settings on the work machine: General, remote access read-only', async () => {
    const fake = await renderRemote('nuwan-hp')
    await openSettings(fake, 'general')
    await until(() => document.querySelector('[data-testid="remote-access-readonly"]') !== null)
    await reviewUi('settings remote host general', {})
  })

  it('settings on the work machine with a long host name', async () => {
    const fake = await renderRemote('build-agent-07.eu-west.corp.example.com')
    await openSettings(fake, 'sidebar')
    await reviewUi('settings remote long host', { widths: [900] })
  })

  it('settings switched to this machine: Themes', async () => {
    const fake = await renderRemote('nuwan-hp')
    fake.emit('openSettingsDialog')
    await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
    await userEvent.click(page.getByTestId('settings-machine-this'))
    await openSettings(fake, 'themes')
    await reviewUi('settings remote this machine themes', {})
  })

  it('the status bar shows the work machine\'s resident and usage', async () => {
    await renderRemote('nuwan-hp', (f) => { withRegent(f) })
    await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
    await until(() => document.querySelector('[data-testid="status-item-claude-usage-usage"]') !== null)
    await reviewUi('status bar remote host resident and usage', {})
  })
})

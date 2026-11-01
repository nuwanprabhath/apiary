import { afterEach, describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

/**
 * Install and restart as the person meets it: the progress, the password asked for in the banner,
 * a refused password, a failed install, and a remote window installing the work machine's update.
 */

const OFFER = { phase: 'available' as const, availableVersion: '1.51.0', releaseUrl: 'https://example.invalid/1.51.0' }
const banner = (): ReturnType<typeof page.getByTestId> => page.getByTestId('update-banner')
const phaseIs = (phase: string) => (): boolean => document.querySelector(`[data-testid="update-banner"]`)?.getAttribute('data-phase') === phase

afterEach(() => { history.replaceState(null, '', location.pathname) })

describe('Install and restart', () => {
  it('shows the install under way, then asks for the password in the banner, then restarts', async () => {
    const { fake } = await renderApp({ update: OFFER, updateSudo: { password: 'hunter2' } })
    const seen: string[] = []
    fake.onUpdateChanged((s) => { seen.push(s.installRequested && s.phase === 'downloading' ? 'progress' : s.phase) })
    await userEvent.click(page.getByTestId('update-install-restart'))
    await until(phaseIs('needs-password'))
    expect(seen).toContain('progress')
    await expect.element(banner()).toMatchTextContent('Apiary needs your password to install 1.51.0')
    await expect.element(page.getByTestId('update-password-note')).toMatchTextContent('Your password for sudo on this computer. Used once, never saved.')
    const field = page.getByTestId('update-password')
    await expect.element(field).toHaveAttribute('type', 'password')
    await expect.element(field).toHaveAttribute('autocomplete', 'current-password')
    await expect.element(field).toHaveFocus()
    await userEvent.keyboard('hunter2{Enter}')
    await until(phaseIs('restarting'))
    await expect.element(banner()).toMatchTextContent('Restarting into 1.51.0…')
    expect(fake.callsTo('updateInstallAndRestart')).toEqual([[{ password: 'hunter2' }]])
    expect(fake.callsTo('updateOpenDownloaded')).toEqual([])
  })

  it('a wrong password says so, with the field cleared and focused; Escape goes back to the offer', async () => {
    await renderApp({ update: OFFER, updateSudo: { password: 'hunter2' } })
    await userEvent.click(page.getByTestId('update-install-restart'))
    await until(phaseIs('needs-password'))
    await userEvent.fill(page.getByTestId('update-password'), 'nope')
    await userEvent.click(page.getByTestId('update-password-submit'))
    await expect.element(banner()).toMatchTextContent('Could not install 1.51.0: That password was not accepted.')
    await expect.element(page.getByTestId('update-password')).toHaveValue('')
    await expect.element(page.getByTestId('update-password')).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await until(phaseIs('available'))
    await expect.element(page.getByTestId('update-install-restart')).toBeVisible()
  })

  it('an install that fails shows why and offers the installer by hand, without restarting', async () => {
    const { fake } = await renderApp({ update: OFFER, updateSudo: { failure: 'E: dpkg was interrupted.' } })
    await userEvent.click(page.getByTestId('update-install-restart'))
    await until(phaseIs('downloaded'))
    await expect.element(banner()).toMatchTextContent('Could not install 1.51.0: E: dpkg was interrupted.')
    await expect.element(page.getByTestId('update-open-downloaded')).toBeVisible()
    // The verified file is kept, so the same button tries the install again.
    await expect.element(page.getByTestId('update-install-restart')).toHaveTextContent('Try again')
    const before = fake.callsTo('updatePrepareInstall').length
    await userEvent.click(page.getByTestId('update-install-restart'))
    await until(() => fake.callsTo('updatePrepareInstall').length === before + 1)
  })

  it('in a remote window it names the work machine, asks for the password on it, and has no Open installer', async () => {
    history.replaceState(null, '', `${location.pathname}?chrome=custom&remote=nuwan-hp`)
    const { fake } = await renderApp({
      update: { ...OFFER, downloadedPath: '/fixture/downloads/apiary_1.51.0_amd64.deb', install: { hint: 'To install it yourself, run:', command: 'sudo apt install x.deb', action: 'reveal' } },
      updateSudo: { password: 'hunter2', failure: 'E: broken.' },
    })
    await expect.element(banner()).toMatchTextContent('Update nuwan-hp to 1.51.0')
    await userEvent.click(page.getByTestId('update-install-restart'))
    await until(phaseIs('needs-password'))
    await expect.element(page.getByTestId('update-password-note')).toMatchTextContent('Your password on nuwan-hp.')
    await userEvent.keyboard('hunter2{Enter}')
    await until(phaseIs('downloaded'))
    await expect.element(page.getByTestId('update-open-downloaded')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('update-copy-command')).toBeVisible()
    expect(fake.callsTo('updateInstallAndRestart')).toEqual([[{ password: 'hunter2' }]])
  })
})

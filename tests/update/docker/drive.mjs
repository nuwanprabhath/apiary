// Runs inside the update bed's container: attaches to the installed Apiary over CDP (it was started
// with --remote-debugging-port=9222; Playwright's _electron cannot attach to a running binary) and
// presses Install and restart. Usage: node drive.mjs <wrong password|-> <password|->; `-` means
// sudo needs none, so no prompt may appear. Prints one line per step.
import { createRequire } from 'node:module'

const { chromium } = createRequire('/app/package.json')('playwright-core')
const [wrong, right] = process.argv.slice(2)
const say = (line) => { process.stdout.write(`${line}\n`) }

async function connect() {
  for (let i = 0; i < 120; i++) {
    try {
      return await chromium.connectOverCDP('http://127.0.0.1:9222')
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('Apiary never opened its debugging port')
}

async function appPage(browser) {
  for (let i = 0; i < 120; i++) {
    const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().includes('index.html'))
    if (page !== undefined) return page
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('no Apiary window')
}

const browser = await connect()
const page = await appPage(browser)
const install = page.getByTestId('update-install-restart')
await install.waitFor({ timeout: 90_000 })
say('banner offers Install and restart')
await install.click()

if (right === '-') {
  // NOPASSWD: the install runs at once; the password field must never appear before the app quits.
  const asked = await page.getByTestId('update-password').waitFor({ timeout: 20_000 }).then(() => true, () => false)
  say(asked ? 'ASKED FOR A PASSWORD' : 'no password asked')
  process.exit(asked ? 1 : 0)
}

const field = page.getByTestId('update-password')
await field.waitFor({ timeout: 90_000 })
say('password asked')
await field.fill(wrong)
await page.getByTestId('update-password-submit').click()
await page.getByText('That password was not accepted.').waitFor({ timeout: 60_000 })
say('wrong password refused')
await field.fill(right)
await page.getByTestId('update-password-submit').click()
say('right password sent')
// The app quits once installed; the connection closing is the expected end.
await page.waitForEvent('close', { timeout: 180_000 }).catch(() => {})
process.exit(0)

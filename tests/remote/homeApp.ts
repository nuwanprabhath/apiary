import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dirname, '../..')

export interface HomeApp {
  app: ElectronApplication
  page: Page
}

/**
 * This Mac's built app as the HOME machine: a fixture home with no sessions, headless (no window on
 * the screen), `APIARY_SSH_CONFIG` pointing at the bed. Mirrors `launchApiary` in tests/e2e/helpers.ts,
 * which imports Playwright's test runner and so cannot be loaded under Vitest.
 */
export async function launchHome(root: string, sshConfig: string): Promise<HomeApp> {
  const home = join(root, 'home')
  const userData = join(home, 'userdata')
  mkdirSync(join(home, 'projects'), { recursive: true })
  mkdirSync(userData, { recursive: true })
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ plugins: { 'claude-usage': false } }))
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined) env[k] = v
  }
  const app = await electron.launch({
    args: [`--user-data-dir=${userData}`, REPO],
    env: {
      ...env,
      APIARY_DEFAULT_THEME: 'original',
      APIARY_CONFIG_ROOT: home,
      APIARY_DB_PATH: join(home, 'apiary.db'),
      APIARY_GLAB_PATH: '',
      APIARY_CODE_PATH: '',
      APIARY_HEADLESS: '1',
      APIARY_SSH_CONFIG: sshConfig,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.locator('html[data-ready="true"]').waitFor({ state: 'attached' })
  return { app, page }
}

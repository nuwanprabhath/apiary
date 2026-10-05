import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { launchApiary, importAll } from '../../../../tests/e2e/helpers'
import { note, shot } from './lib'

/**
 * Is this checkout worth driving? Boots the built app on the standard fixture, checks it is the
 * version in package.json (a stale `out/` is the usual reason a drive "proves" old behaviour),
 * and that the sidebar lists the fixture's sessions.
 */
test('doctor', async () => {
  const h = await launchApiary()
  try {
    const want = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../package.json'), 'utf8')) as { version: string }).version
    const got = await h.app.evaluate(({ app }) => app.getVersion())
    expect(got, 'out/ was built from another version; run npm run build').toBe(want)

    await expect(h.page.getByTestId('sidebar')).toBeVisible()
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    await expect(h.page.getByTestId('session-item')).toHaveCount(4)

    note('doctor', { version: got, sessions: 4 })
    await shot(h.page, 'doctor')
  } finally {
    await h.close()
  }
})

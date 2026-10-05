import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { Page } from '@playwright/test'

/**
 * Where a drive's proof goes: `.verify/evidence/<run>/`, outside anything a cleanup or a
 * Playwright run deletes. `verify.sh` names the run; a drive started some other way gets a
 * timestamp.
 */
export function evidenceDir(): string {
  const run = process.env.VERIFY_RUN ?? new Date().toISOString().replace(/[:.]/g, '-')
  const dir = resolve(import.meta.dirname, '../../../../.verify/evidence', run)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** A screenshot of the window, or of one region of it, saved as evidence. */
export async function shot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }): Promise<string> {
  const path = join(evidenceDir(), `${name}.png`)
  await page.screenshot({ path, clip })
  return path
}

/** Measured state saved next to the screenshots, so a proof carries numbers, not only pictures. */
export function note(name: string, data: unknown): string {
  const path = join(evidenceDir(), `${name}.json`)
  writeFileSync(path, JSON.stringify(data, null, 2))
  return path
}

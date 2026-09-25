import { test, expect } from '@playwright/test'
import { launchApiary, importAll, type Harness } from '../helpers'

/**
 * The theme generator against the real `claude` (opt-in: APIARY_LIVE_CLAUDE=1; spends tokens).
 * What it proves beyond the stand-in: that a real reply to a real request is a theme the
 * validator has nothing to throw away — the schema and the prompt are describing the same thing.
 */
test.skip(process.env.APIARY_LIVE_CLAUDE !== '1', 'live Claude specs are opt-in: APIARY_LIVE_CLAUDE=1')
test.setTimeout(240_000)

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
})
test.afterEach(async () => { await h.close() })

for (const [slug, request] of [['matrix', 'I like to have a theme like the Matrix movie'], ['cyberpunk', 'I like to have a cool cyber punk theme']] as const) {
  test(`real claude designs "${request}" with nothing for the validator to throw away`, async () => {
    const result = await h.page.evaluate((r) => window.apiary.themeGenerate(r, null), request)
    // Nudges for readability are fine; dropped colours or unknown options mean the prompt and the
    // schema told Claude something the validator does not accept.
    expect(result.note ?? '').not.toMatch(/invalid|unknown/)
    expect(result.spec.effects.length).toBeGreaterThan(0)
    await h.page.evaluate((spec) => window.apiary.themeSave(spec.name, spec).then((s) => window.apiary.themeApply(s.id)), result.spec)
    await h.page.getByText('Fix CSV export bug').first().click().catch(() => {})
    await h.page.waitForTimeout(1500)
    await h.page.screenshot({ path: `/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/live-${slug}.png` })
    console.log(slug, JSON.stringify({ name: result.spec.name, note: result.note, font: result.spec.font, effects: result.spec.effects.map((e) => e.kind) }))
  })
}

for (const [slug, request, refracts] of [['liquid-glass', 'Mac OS like liquid glass', true], ['frosted', 'Frosted glass', false]] as const) {
  test(`real claude answers "${request}" with a glass theme`, async () => {
    const result = await h.page.evaluate((r) => window.apiary.themeGenerate(r, null), request)
    console.log(slug, JSON.stringify({ note: result.note, material: result.spec.material, effects: result.spec.effects, palette: result.spec.palette }))
    expect(result.note ?? '').not.toMatch(/invalid|unknown/)
    expect(result.spec.material.kind).toBe('glass')
    // Something see-through: at least the panels.
    expect(parseInt(result.spec.palette['bg-panel']?.slice(7, 9) ?? 'ff', 16)).toBeLessThan(255)
    if (refracts) expect(result.spec.material.refraction).toBeGreaterThan(0)
    await h.page.evaluate((spec) => window.apiary.themeSave(spec.name, spec).then((s) => window.apiary.themeApply(s.id)), result.spec)
    await h.page.getByText('Fix CSV export bug').first().click().catch(() => {})
    await h.page.waitForTimeout(1500)
    await h.page.screenshot({ path: `/private/tmp/claude-501/-Users-nuwan-projects-pet-projects/a021aefb-2a2b-46c0-b30f-d6ec7a9e02f5/scratchpad/live-${slug}.png` })
    console.log(slug, JSON.stringify({ name: result.spec.name, note: result.note, material: result.spec.material, effects: result.spec.effects.map((e) => e.kind), panel: result.spec.palette['bg-panel'], bg: result.spec.palette.bg }))
  })
}

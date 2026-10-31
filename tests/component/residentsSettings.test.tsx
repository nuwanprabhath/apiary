import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { ResidentConfig } from '@shared/domain/residents'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { deskConfig, withDeskFields } from './residentFixtures'

/** Settings → Residents: adding Regent, the card's fields saved through the settings write, and the confirms. */
const regent: ResidentConfig = {
  id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70, permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}

const el = (id: string): Element | null => document.querySelector(`[data-testid="${id}"]`)
const input = (id: string): HTMLInputElement => document.querySelector<HTMLInputElement>(`[data-testid="${id}"]`) as HTMLInputElement

async function openResidents(residents: ResidentConfig[] = [], arrange?: (fake: FakeApiary) => void): Promise<FakeApiary> {
  const { fake } = await renderApp({ settings: { residents } }, arrange)
  fake.emit('openSettingsDialog')
  await until(() => el('settings-dialog') !== null)
  await userEvent.click(page.getByTestId('settings-nav-residents'))
  await until(() => el('residents-section') !== null)
  return fake
}

describe('Settings → Residents', () => {
  it('Add Regent creates a resident with the defaults', async () => {
    const fake = await openResidents()
    await userEvent.click(page.getByTestId('resident-add-regent'))
    await until(() => el('resident-card-regent') !== null)
    expect(fake.state.settings.residents).toHaveLength(1)
    expect(fake.state.settings.residents[0]).toMatchObject({ name: 'Regent', enabled: false, model: 'sonnet' })
    expect(el('resident-add-regent')).toBeNull()
  })

  it("the dialog's Save keeps a resident added and switched on while it was open", async () => {
    // The section saves each change at once, but Save sends the draft read when the dialog opened:
    // without residents among the instant settings, Save put back the empty list and Regent vanished.
    const fake = await openResidents()
    await userEvent.click(page.getByTestId('resident-add-regent'))
    await until(() => el('resident-card-regent') !== null)
    await userEvent.click(page.getByRole('switch', { name: 'Enable Regent' }))
    await until(() => fake.state.settings.residents[0]?.enabled === true)
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => document.querySelector('[data-testid="settings-save"]') === null)
    expect(fake.state.settings.residents).toHaveLength(1)
    expect(fake.state.settings.residents[0]).toMatchObject({ id: 'regent', enabled: true })
  })

  it('renaming saves on blur and reverts when empty', async () => {
    const fake = await openResidents([regent])
    const name = input('resident-name-regent')
    await userEvent.fill(name, 'Queen Bee')
    name.blur()
    await until(() => fake.state.settings.residents[0].name === 'Queen Bee')
    await userEvent.fill(name, '')
    name.blur()
    await until(() => input('resident-name-regent').value === 'Queen Bee')
    expect(fake.state.settings.residents[0].name).toBe('Queen Bee')
  })

  it('the day chips toggle and save', async () => {
    const fake = await openResidents([regent])
    expect(el('resident-day-regent-6')?.getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(page.getByTestId('resident-day-regent-6'))
    await until(() => fake.state.settings.residents[0].schedule.days.includes(6))
    await userEvent.click(page.getByTestId('resident-day-regent-1'))
    await until(() => !fake.state.settings.residents[0].schedule.days.includes(1))
    await until(() => el('resident-day-regent-1')?.getAttribute('aria-pressed') === 'false')
  })

  it('an overnight range shows (overnight)', async () => {
    await openResidents([{ ...regent, schedule: { ...regent.schedule, start: '22:00', end: '06:00' } }])
    expect(el('resident-card-regent')?.textContent).toContain('(overnight)')
    await openResidents([regent])
    expect(el('resident-card-regent')?.textContent).not.toContain('(overnight)')
  })

  it('digest progress renders', async () => {
    const fake = await openResidents([regent])
    expect(el('resident-digest-regent')?.textContent).toContain('Not started yet')
    fake.emit('residentsChanged', [{
      id: 'regent', kind: 'regent', name: 'Regent', enabled: true, state: 'working', activity: null, onDuty: true,
      appearance: { glyph: 'bee', palette: 'gold', animation: 'halo' }, digest: { done: 612, total: 840 }, attention: null, permissions: [], quickActions: [], setupNeeded: null, cycle: null,
    }])
    await until(() => (el('resident-digest-regent')?.textContent ?? '').includes('Digested 612 of 840 sessions'))
  })

  it('Re-digest asks to confirm', async () => {
    const fake = await openResidents([regent])
    await userEvent.click(page.getByTestId('resident-redigest-regent'))
    await until(() => el('resident-confirm-dialog') !== null)
    expect(el('resident-confirm-dialog')?.textContent).toContain('quota')
    await userEvent.click(page.getByTestId('resident-confirm-cancel'))
    await until(() => el('resident-confirm-dialog') === null)
    expect(fake.callsTo('residentRedigest')).toHaveLength(0)
    await userEvent.click(page.getByTestId('resident-redigest-regent'))
    await userEvent.click(page.getByTestId('resident-confirm-ok'))
    await until(() => fake.callsTo('residentRedigest').length > 0)
  })

  it("the section opens from onOpenSettings('residents')", async () => {
    const { fake } = await renderApp({ settings: { residents: [] } })
    fake.emit('openSettingsDialog')
    await until(() => el('settings-dialog') !== null)
    expect(el('residents-section')).toBeNull()
    await userEvent.click(page.getByTestId('settings-nav-residents'))
    await until(() => el('residents-section') !== null)
  })

  it('offers one Add button per kind with no instance, with its blurb', async () => {
    const fake = await openResidents()
    await until(() => el('resident-add-mr-desk') !== null)
    expect(el('resident-add-regent')?.textContent).toBe('Add Regent')
    expect(el('resident-add-mr-desk')?.textContent).toBe('Add MR Desk')
    expect(el('residents-section')?.textContent).toContain('Watches the GitLab MRs you review')
    await userEvent.click(page.getByTestId('resident-add-mr-desk'))
    await until(() => el('resident-card-mr-desk') !== null)
    expect(fake.state.settings.residents.map((c) => c.kind)).toEqual(['mr-desk'])
    expect(el('resident-add-mr-desk')).toBeNull()
    expect(el('resident-add-regent')).not.toBeNull()
  })

  it('the permission mode saves', async () => {
    const fake = await openResidents([regent])
    await userEvent.selectOptions(page.getByTestId('resident-permission-mode-regent'), 'manual')
    await until(() => fake.state.settings.residents[0].permissionMode === 'manual')
    expect(el('resident-card-regent')?.textContent).toContain('What it may do without asking. Anything else asks in its chat.')
  })

  it('the lookback saves a preset, All history and a custom amount and unit', async () => {
    const fake = await openResidents([regent])
    expect(input('resident-lookback-regent').value).toBe('all')
    await userEvent.selectOptions(page.getByTestId('resident-lookback-regent'), '3m')
    await until(() => fake.state.settings.residents[0].digestLookback?.amount === 3)
    expect(fake.state.settings.residents[0].digestLookback).toEqual({ amount: 3, unit: 'months' })
    expect(el('resident-lookback-amount-regent')).toBeNull()
    await userEvent.selectOptions(page.getByTestId('resident-lookback-regent'), 'custom')
    await until(() => el('resident-lookback-amount-regent') !== null)
    await userEvent.fill(input('resident-lookback-amount-regent'), '45')
    input('resident-lookback-amount-regent').blur()
    await until(() => fake.state.settings.residents[0].digestLookback?.amount === 45)
    await userEvent.selectOptions(page.getByTestId('resident-lookback-unit-regent'), 'days')
    await until(() => fake.state.settings.residents[0].digestLookback?.unit === 'days')
    expect(fake.state.settings.residents[0].digestLookback).toEqual({ amount: 45, unit: 'days' })
    await userEvent.selectOptions(page.getByTestId('resident-lookback-regent'), 'all')
    await until(() => fake.state.settings.residents[0].digestLookback === null)
    expect(el('resident-card-regent')?.textContent).toContain('Older sessions are not digested. Changing this applies on the next pass.')
  })

  it('a custom lookback opens as Custom, and an amount is kept within 1 to 999', async () => {
    const fake = await openResidents([{ ...regent, digestLookback: { amount: 10, unit: 'days' } }])
    expect(input('resident-lookback-regent').value).toBe('custom')
    expect(input('resident-lookback-amount-regent').value).toBe('10')
    await userEvent.fill(input('resident-lookback-amount-regent'), '5000')
    input('resident-lookback-amount-regent').blur()
    await until(() => fake.state.settings.residents[0].digestLookback?.amount === 999)
    expect(input('resident-lookback-amount-regent').value).toBe('999')
  })

  it('a kind with a cycle has Check every, which saves; the next check shows; Check now runs a cycle', async () => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 45).getTime()
    const fake = await openResidents([deskConfig({ project: 'g/p', repoPath: '/code/app' })], (f) => { f.state.residentNextCycle.set('mr-desk', next) })
    await until(() => el('resident-cycle-mr-desk') !== null)
    expect(el('resident-cycle-regent')).toBeNull()
    expect(document.querySelector<HTMLSelectElement>('[data-testid="resident-cycle-mr-desk"]')!.value).toBe('15')
    expect([...document.querySelectorAll('[data-testid="resident-cycle-mr-desk"] option')].map((o) => o.textContent))
      .toEqual(['5 minutes', '10 minutes', '15 minutes', '30 minutes', '60 minutes'])
    await until(() => el('resident-next-check-mr-desk')?.textContent === 'Next check at 14:45')
    await userEvent.selectOptions(page.getByTestId('resident-cycle-mr-desk'), '30')
    await until(() => fake.state.settings.residents[0].cycleEveryMinutes === 30)
    await userEvent.click(page.getByTestId('resident-check-now-mr-desk'))
    await until(() => fake.callsTo('residentQuickAction').length === 1)
    expect(fake.callsTo('residentQuickAction')[0]).toEqual(['mr-desk', 'cycle'])
    await until(() => (fake.state.residentHistory.get('mr-desk') ?? []).some((m) => m.text === 'Run one MR desk cycle.'))
  })

  it('a kind that does not digest has no lookback, digest model, usage pause or Re-digest', async () => {
    await openResidents([deskConfig()])
    await until(() => el('resident-permission-mode-mr-desk') !== null && el('resident-add-regent') !== null)
    expect(el('resident-lookback-mr-desk')).toBeNull()
    expect(el('resident-digest-model-mr-desk')).toBeNull()
    expect(el('resident-pause-mr-desk')).toBeNull()
    expect(el('resident-redigest-mr-desk')).toBeNull()
    expect(el('resident-digest-mr-desk')).toBeNull()
  })

  it('a text option saves on blur, and an empty required one is marked', async () => {
    const fake = await openResidents([deskConfig()], withDeskFields)
    await until(() => el('resident-option-mr-desk-project') !== null)
    expect(el('resident-required-mr-desk-project')).not.toBeNull()
    await userEvent.fill(input('resident-option-mr-desk-project'), 'group/app')
    input('resident-option-mr-desk-project').blur()
    await until(() => fake.state.settings.residents[0].options.project === 'group/app')
    await until(() => el('resident-required-mr-desk-project') === null)
  })

  it('a folder option is chosen with Choose… only, never typed', async () => {
    const folder = '/Users/me/src/very/deep/folder/app'
    const fake = await openResidents([deskConfig()], (f) => {
      withDeskFields(f)
      // As main does for a folder field: it stores the choice itself (the fake's own check reads main's kinds).
      f.override('residentPickFolder', async (id: string, key: string) => {
        f.state.settings = { ...f.state.settings, residents: f.state.settings.residents.map((c) => (c.id === id ? { ...c, options: { ...c.options, [key]: folder } } : c)) }
        return folder
      })
    })
    await until(() => el('resident-option-mr-desk-clone') !== null)
    expect(el('resident-option-mr-desk-clone')?.closest('.resident-field')?.querySelector('input')).toBeNull()
    await userEvent.click(page.getByTestId('resident-option-choose-mr-desk-clone'))
    await until(() => fake.callsTo('residentPickFolder').length === 1)
    expect(fake.callsTo('residentPickFolder')[0]).toEqual(['mr-desk', 'clone'])
    await until(() => (el('resident-option-mr-desk-clone')?.textContent ?? '').includes(folder))
  })
})

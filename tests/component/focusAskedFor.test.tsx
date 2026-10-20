import { describe, expect, it } from 'vitest'
import type { JSX } from 'react'
import { mountUi } from './mountUi'
import { WorktreeNameStep } from '../../src/renderer/features/git/WorktreeNameStep'
import { WorktreeNewBranchStep } from '../../src/renderer/features/git/WorktreeNewBranchStep'
import { WorktreeBranchStep } from '../../src/renderer/features/git/WorktreeBranchStep'
import { TerminalTabRow } from '../../src/renderer/features/terminal/TerminalTabRow'
import { ThemeCurrent } from '../../src/renderer/theme/ThemeCurrent'
import { PetChat } from '../../src/renderer/features/pets/PetChat'
import { EditableSessionTitle } from '../../src/renderer/features/pane/EditableSessionTitle'
import { userEvent } from 'vitest/browser'
import { ORIGINAL_THEME } from '@shared/theme/spec'
import type { PetRecord } from '@shared/pets/state'

/** Mounts `node` while another text field has focus; whether the field with `testId` has it now.
 *  A field the person asked for (a click, a menu choice, a key) takes focus even from a text field. */
async function takesFocusFromTypingField(node: JSX.Element, testId: string): Promise<boolean> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const elsewhere = document.createElement('input')
  host.appendChild(elsewhere)
  elsewhere.focus()
  await mountUi(node)
  const field = document.querySelector(`[data-testid="${testId}"]`)
  const took = field !== null && document.activeElement === field
  host.remove()
  return took
}

describe('a field the person asked for takes focus, even from another text field', () => {
  it('the new-worktree name step', async () => {
    const took = await takesFocusFromTypingField(<WorktreeNameStep name="" options={null} nameProblem={null} onName={() => {}} onNext={() => {}} onClose={() => {}} />, 'new-worktree-name')
    expect(took).toBe(true)
  })

  it('the new-worktree branch-name step', async () => {
    const took = await takesFocusFromTypingField(<WorktreeNewBranchStep branchName="" from={undefined} busy={false} branchProblem={null} onBranchName={() => {}} onBack={() => {}} onCreate={() => {}} />, 'new-worktree-branch-name')
    expect(took).toBe(true)
  })

  it('the new-worktree branch list step', async () => {
    const took = await takesFocusFromTypingField(
      <WorktreeBranchStep mode="branch" options={null} query="" local={[]} remote={[]} busy={false} onQuery={() => {}} onPick={() => {}} onNewBranch={() => {}} onCurrentHead={() => {}} onBack={() => {}} />,
      'new-worktree-branch-search',
    )
    expect(took).toBe(true)
  })

  it('the theme name field', async () => {
    const took = await takesFocusFromTypingField(
      <ThemeCurrent
        current={{ id: null, spec: ORIGINAL_THEME, saved: false }} activeId={null} naming="save" name="" onName={() => {}}
        onSubmitName={() => {}} onStartNaming={() => {}} onCancelNaming={() => {}}
      />,
      'theme-save-name',
    )
    expect(took).toBe(true)
  })

  it('a pet chat', async () => {
    const pet = { id: 'p', size: 64, spec: { name: 'Pip', tagline: '' } } as unknown as PetRecord
    const took = await takesFocusFromTypingField(<PetChat pet={pet} anchor={{ x: 100, y: 100 }} history={[]} onSaid={() => {}} onClose={() => {}} />, 'pet-chat-input')
    expect(took).toBe(true)
  })

  it('a terminal tab being renamed (F2 is pressed in the terminal, a text area)', async () => {
    const took = await takesFocusFromTypingField(
      <ul>
        <TerminalTabRow
          tab={{ id: 't1', name: 'one' }} active keyboardFocused={false} editing draft="one"
          onDraft={() => {}} onCommit={() => {}} onCancel={() => {}} onClick={() => {}} onRename={() => {}} onDelete={() => {}} onReorder={() => {}}
        />
      </ul>,
      'terminal-tab-rename-input',
    )
    expect(took).toBe(true)
  })
})

/** Mounts `node`; the text of the field with `testId` that is selected, once it has focus. */
async function selectedOnOpen(node: JSX.Element, testId: string, open?: () => Promise<void>): Promise<string> {
  await mountUi(node)
  await open?.()
  const field = document.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`)
  if (field === null || document.activeElement !== field) return '(not focused)'
  return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
}

// A field opened on an existing name (a rename, a suggestion, a filter kept from a step back) holds
// it selected, so typing replaces it. Four rename fields once opened with the caret at the end,
// each its own copy of focus-then-select or missing the select; `focusAskedFor` now does both.
describe('a field the person asked for opens with its text selected', () => {
  it('a terminal being renamed', async () => {
    const text = await selectedOnOpen(
      <ul>
        <TerminalTabRow
          tab={{ id: 't1', name: 'Terminal 1' }} active keyboardFocused={false} editing draft="Terminal 1"
          onDraft={() => {}} onCommit={() => {}} onCancel={() => {}} onClick={() => {}} onRename={() => {}} onDelete={() => {}} onReorder={() => {}}
        />
      </ul>,
      'terminal-tab-rename-input',
    )
    expect(text).toBe('Terminal 1')
  })

  it('a theme being renamed', async () => {
    const text = await selectedOnOpen(
      <ThemeCurrent
        current={{ id: 'ocean', spec: ORIGINAL_THEME, saved: true }} activeId="ocean" naming="rename" name="Ocean" onName={() => {}}
        onSubmitName={() => {}} onStartNaming={() => {}} onCancelNaming={() => {}}
      />,
      'theme-save-name',
    )
    expect(text).toBe('Ocean')
  })

  it('the new-worktree name step, back on a name already typed', async () => {
    const text = await selectedOnOpen(
      <WorktreeNameStep name="species-list" options={null} nameProblem={null} onName={() => {}} onNext={() => {}} onClose={() => {}} />,
      'new-worktree-name',
    )
    expect(text).toBe('species-list')
  })

  it('the session title being renamed', async () => {
    const text = await selectedOnOpen(
      <EditableSessionTitle title="Fix CSV export bug" onRename={() => {}} />,
      'session-title-input',
      async () => { await userEvent.click(document.querySelector<HTMLElement>('[data-testid="session-title-edit"]')!) },
    )
    expect(text).toBe('Fix CSV export bug')
  })
})

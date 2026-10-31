import type { ResidentStatus } from '@shared/domain/residents'
import { runQuickAction } from '../../state/residentChat'
import { openResidentPopup } from '../../state/residentPopup'
import { revealResidentCard, setResidentEnabled } from '../../state/residentSettings'
import type { ContextMenuItem } from '../../ui/contextMenuItem'

/**
 * The badge's right-click menu: open the chat, the kind's own quick actions (each opens the popup
 * too, so its output is seen), then turning it on or off and its Settings card.
 */
export function residentMenuItems(resident: ResidentStatus, onOpenSettings: (section: string) => void): ContextMenuItem[] {
  const { id } = resident
  return [
    { id: 'open', label: 'Open chat', run: () => { openResidentPopup(id) } },
    ...resident.quickActions.map((a): ContextMenuItem => ({
      id: `action-${a.id}`,
      label: a.label,
      run: () => { openResidentPopup(id); runQuickAction(id, a.id) },
    })),
    {
      id: 'toggle',
      label: resident.enabled ? 'Turn off' : 'Turn on',
      separator: true,
      run: () => { setResidentEnabled(id, !resident.enabled) },
    },
    { id: 'settings', label: 'Settings…', run: () => { revealResidentCard(id); onOpenSettings('residents') } },
  ]
}

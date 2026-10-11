import type { CSSProperties, JSX, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { normalisePlace, placeToPoint, type Habitat } from '@shared/pets/habitat'
import type { PetRecord } from '@shared/pets/state'
import { PetSprite } from './PetSprite'
import type { Pose } from './usePetBrain'

interface PetHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>, id: string) => void
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord) => void
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord) => void
  onPointerCancel: () => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>, pet: PetRecord) => void
  onContextMenu: (e: { preventDefault: () => void; clientX: number; clientY: number }, pet: PetRecord) => void
}

interface Props {
  pet: PetRecord
  pose: Pose
  habitat: Habitat
  held: boolean
  handlers: PetHandlers
}

/** One pet on the layer: positioned by its pose, draggable, and speaking in a bubble. */
export function PetFigure({ pet, pose, habitat, held, handlers }: Props): JSX.Element {
  const place = normalisePlace(habitat, pose.place, 0)
  const pt = placeToPoint(habitat, place, pet.size)
  const align = pt.x < 120 ? 'start' : pt.x > window.innerWidth - 120 ? 'end' : 'middle'
  const style = {
    '--pet-size': `${String(pet.size)}px`,
    transform: `translate(${String(pt.x - pet.size / 2)}px, ${String(pt.y - pet.size)}px)`,
    transitionDuration: `${String(pose.ms)}ms`,
  } as CSSProperties
  return (
    <div
      className="pet"
      data-testid="pet"
      data-own-context-menu
      data-pet-id={pet.id}
      data-held={held}
      data-region={place.region}
      role="button"
      tabIndex={0}
      aria-label={`${pet.spec.name} — click or press Enter to chat, drag to move, right-click or Shift+F10 for more`}
      title={pet.spec.name}
      style={style}
      onKeyDown={(e) => { handlers.onKeyDown(e, pet) }}
      onPointerDown={(e) => { handlers.onPointerDown(e, pet.id) }}
      onPointerMove={(e) => { handlers.onPointerMove(e, pet) }}
      onPointerUp={(e) => { handlers.onPointerUp(e, pet) }}
      onPointerCancel={handlers.onPointerCancel}
      onContextMenu={(e) => { handlers.onContextMenu(e, pet) }}
    >
      <PetSprite spec={pet.spec} size={pet.size} activity={held ? 'held' : pose.activity} face={held ? 'surprised' : pose.face} facing={pose.facing} onRail={place.region === 'rail'} />
      {pose.say !== null && !held && (
        <div className="pet-bubble" data-testid="pet-bubble" data-kind={pose.say.kind} data-align={align}>{pose.say.text}</div>
      )}
    </div>
  )
}

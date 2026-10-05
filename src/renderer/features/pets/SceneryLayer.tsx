import type { CSSProperties, JSX } from 'react'
import type { Scenery } from '@shared/pets/brain'
import { placeToPoint, type Habitat } from '@shared/pets/habitat'
import { PET_FRAME_UNITS, SCENERY_FRAME } from './render3d/frames'
import { useProps } from './render3d/usePetImages'

interface Props {
  habitat: Habitat
  items: Record<string, { item: Scenery; leaving: boolean }>
  /** The pets' size, so scenery is to their scale. */
  size: number
}

/**
 * What a scene brings out — a pond, a tree, a picnic, the ball in play — drawn behind the pets at
 * their scale, standing on the same floor. The ball's flight is two CSS animations (across, and
 * the arc), so it costs the page nothing while it flies. Without 3D renders, scenery is not drawn
 * and the pets act their scene out on their own.
 */
export function SceneryLayer({ habitat, items, size }: Props): JSX.Element | null {
  const props = useProps()
  if (props === null) return null
  const perUnit = size / PET_FRAME_UNITS
  return (
    <>
      {Object.values(items).map(({ item, leaving }) => {
        const art = props.scenery[item.kind]
        const frame = SCENERY_FRAME[item.kind]
        const height = frame.halfHeight * 2 * perUnit
        const width = height * art.aspect
        const at = placeToPoint(habitat, item.at, size)
        if (item.kind === 'ball' && item.to !== undefined) {
          const to = placeToPoint(habitat, item.to, size)
          const ball = size * 0.26
          const style = {
            '--ball-from': `${String(at.x - ball / 2)}px`,
            '--ball-to': `${String(to.x - ball / 2)}px`,
            '--ball-flight': `${String((item.ms ?? 1600) / 2)}ms`,
            '--ball-height': `${String(item.style === 'tennis' ? size * 0.35 : size * 0.7)}px`,
            top: at.y - size * 0.5 - ball / 2,
            width: ball,
            height: ball,
          } as CSSProperties
          return (
            <div key={item.key} className="pet-ball" data-testid="pet-ball" data-leaving={leaving} data-style={item.style} style={style}>
              <img src={art.src} alt="" draggable={false} />
            </div>
          )
        }
        return (
          <img
            key={item.key}
            className="pet-scenery"
            data-testid="pet-scenery"
            data-kind={item.kind}
            data-leaving={leaving}
            src={art.src}
            alt=""
            draggable={false}
            style={{ left: at.x - width / 2, top: at.y - height + size * 0.04, width, height }}
          />
        )
      })}
    </>
  )
}

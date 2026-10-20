import type { JSX } from 'react'
import {
  BUSY_ANIMATION_IDS, BUSY_ANIMATIONS, BUSY_COLORS, busyColorFor, type BusyAnimationId, type BusyColorId,
} from '@shared/domain/busyAnimation'
import { BusyGlyph } from '../ui/BusyGlyph'
import { saveInstantSetting, useAppSettings } from '../state/settingsStore'
import { surface } from '../state/policy'

const saveBusySetting = (patch: { busyAnimation?: BusyAnimationId; busyAnimationColor?: BusyColorId }): void => {
  surface(saveInstantSetting(patch), 'Could not change the setting')
}

/**
 * Settings → Themes: the animation beside "Claude is working", each card showing it live, and its
 * colour. Saved at once, like Animations above it. The colours are those the chosen animation offers.
 */
export function BusyAnimationRows(): JSX.Element {
  const { busyAnimation, busyAnimationColor } = useAppSettings()
  const color = busyColorFor(busyAnimation, busyAnimationColor)
  return (
    <div className="settings-row settings-row-stacked busy-settings">
      <span>
        <strong id="busy-animation-label">Working animation</strong>
        <span className="settings-help">Shown beside the line that says Claude is working.</span>
      </span>
      <div className="busy-choices" role="radiogroup" aria-labelledby="busy-animation-label">
        {BUSY_ANIMATION_IDS.map((id) => (
          <label key={id} className="busy-choice" data-testid={`busy-animation-${id}`} data-active={id === busyAnimation}>
            <input
              type="radio"
              className="visually-hidden"
              name="busy-animation"
              value={id}
              checked={id === busyAnimation}
              onChange={() => { saveBusySetting({ busyAnimation: id }) }}
            />
            <span className="busy-choice-preview"><BusyGlyph animation={id} color={busyAnimationColor} /></span>
            <span className="busy-choice-name">{BUSY_ANIMATIONS[id].label}</span>
            <span className="busy-choice-help">{BUSY_ANIMATIONS[id].description}</span>
          </label>
        ))}
      </div>
      <span><strong id="busy-color-label">Colour</strong></span>
      <div className="busy-colors" role="radiogroup" aria-labelledby="busy-color-label">
        {BUSY_ANIMATIONS[busyAnimation].colors.map((id) => (
          <label key={id} className="busy-color" data-testid={`busy-color-${id}`} data-active={id === color}>
            <input
              type="radio"
              className="visually-hidden"
              name="busy-color"
              value={id}
              checked={id === color}
              onChange={() => { saveBusySetting({ busyAnimationColor: id }) }}
            />
            <span className="busy-swatch" data-busy-color={id} aria-hidden="true">
              <span className="busy-swatch-dot" data-planet={1} />
              <span className="busy-swatch-dot" data-planet={2} />
              <span className="busy-swatch-dot" data-planet={3} />
            </span>
            {BUSY_COLORS[id].label}
          </label>
        ))}
      </div>
    </div>
  )
}

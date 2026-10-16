import type { JSX } from 'react'
import { ThemesSection } from '../../../theme/ThemesSection'

/**
 * `ThemesSection` takes no props of its own; this is just the registry-shaped adapter so
 * every entry in `SECTIONS` has the same `{ draft, patch }` signature.
 */
export function ThemesSectionEntry(): JSX.Element {
  return <ThemesSection />
}

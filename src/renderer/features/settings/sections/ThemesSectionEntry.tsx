import type { JSX } from 'react'
import { ThemesSection } from '../../../theme/ThemesSection'

/**
 * `ThemesSection` (the real component, still at `components/ThemesSection.tsx` — its own split is
 * UI-22, not this one) takes no props of its own; this is just the registry-shaped adapter so
 * every entry in `SECTIONS` has the same `{ draft, patch }` signature.
 */
export function ThemesSectionEntry(): JSX.Element {
  return <ThemesSection />
}

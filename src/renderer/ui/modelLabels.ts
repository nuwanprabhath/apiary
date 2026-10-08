import type { ThemeModel } from '@shared/theme/models'

/**
 * Picker labels for `THEME_MODELS` (the shared model list; `PetModel` is the same type). The two
 * generators word them differently, a pet being cheap to hatch and a theme worth some care, so each
 * has its own map, typed `Record` so a new model is a compile error until both are labelled.
 */
export const THEME_MODEL_LABELS: Record<ThemeModel, string> = {
  sonnet: 'Sonnet (balanced)',
  haiku: 'Haiku (fastest)',
  opus: 'Opus (most careful)',
}

export const PET_MODEL_LABELS: Record<ThemeModel, string> = {
  haiku: 'Haiku (fastest, default)',
  sonnet: 'Sonnet',
  opus: 'Opus',
}

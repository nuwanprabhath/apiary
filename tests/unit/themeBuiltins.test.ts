import { describe, it, expect } from 'vitest'
import { BUILTIN_THEMES } from '../../src/shared/theme/builtins'
import { validateTheme } from '../../src/shared/theme/validate'

describe('built-in themes', () => {
  // They are the generator's examples, so they must be exemplary: nothing for the validator to fix.
  for (const { id, spec } of BUILTIN_THEMES) {
    it(`${id} passes validation untouched`, () => {
      const result = validateTheme(spec)
      expect(result.report).toEqual({ droppedColors: 0, clamped: 0, unknown: 0, nudged: 0 })
      expect(result.spec).toEqual(spec)
    })
  }
})

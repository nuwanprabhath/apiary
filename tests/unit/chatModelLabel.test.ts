import { describe, it, expect } from 'vitest'
import { modelLabel, type ChatModelInfo } from '../../src/shared/domain/chat'

const MODELS: ChatModelInfo[] = [
  { value: 'default', resolvedModel: 'claude-opus-5-5', displayName: 'Default (recommended)', description: '', efforts: [] },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: '', efforts: [] },
  { value: 'claude-fable-5-1', resolvedModel: 'claude-fable-5-1', displayName: 'Fable 5.1', description: '', efforts: [] },
]

describe('modelLabel', () => {
  it('uses claude\'s own name for the model actually running, not the default alias', () => {
    expect(modelLabel('claude-opus-5-5', MODELS)).toBe('Opus 5.5')
    expect(modelLabel('claude-fable-5-1', MODELS)).toBe('Fable 5.1')
  })

  it('tidies an id the list does not name', () => {
    expect(modelLabel('claude-haiku-4-5-20251001', MODELS)).toBe('Haiku 4.5')
    expect(modelLabel('claude-opus-4-8[1m]', null)).toBe('Opus 4.8')
    expect(modelLabel(null, MODELS)).toBe('Default model')
  })

  it('names an alias with its version when claude names it by family alone (G showed "Opus")', () => {
    const familyOnly: ChatModelInfo[] = [
      { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus', description: 'Opus 5.5 · Best for everyday, complex tasks', efforts: [] },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 5.5 · Efficient for routine tasks', efforts: [] },
    ]
    expect(modelLabel('opus', familyOnly)).toBe('Opus 5.5')
    expect(modelLabel('claude-opus-5-5', familyOnly)).toBe('Opus 5.5')
    expect(modelLabel('sonnet', familyOnly)).toBe('Sonnet 5.5')
  })
})

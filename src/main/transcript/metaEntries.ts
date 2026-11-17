import type { TranscriptBlock } from '@shared/types'

/** How a skill's instructions begin when Claude Code loads them (measured on 2.1.302). */
const SKILL_BASE = /^Base directory for this skill: (\S+)/

const joinedText =(blocks: TranscriptBlock[]): string => blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n')

/**
 * Text Claude Code put in the conversation for a tool, not from you: a `user` entry with `isMeta`
 * and the `sourceToolUseID` of the call that loaded it, a skill's instructions above all (pages of
 * them, which the chat drew as if you had written them).
 */
export function loadedContext(isMeta: boolean, sourceToolUseID: string | undefined, blocks: TranscriptBlock[]): TranscriptBlock | null {
  if (!isMeta || sourceToolUseID === undefined) return null
  const text = joinedText(blocks)
  if (text.trim() === '') return null
  const dir = SKILL_BASE.exec(text)?.[1] ?? null
  return { type: 'loaded_context', name: dir === null ? null : dir.replace(/\/+$/, '').split('/').pop() ?? null, text }
}

/** A recurring job's prompt Claude Code fired itself (`isMeta`, `turnOrigin: 'scheduled'`; measured on 2.1.326): not typed by you. */
export function scheduledPrompt(isMeta: boolean, turnOrigin: string | undefined, blocks: TranscriptBlock[]): TranscriptBlock | null {
  if (!isMeta || turnOrigin !== 'scheduled') return null
  const text = joinedText(blocks)
  return text.trim() === '' ? null : { type: 'scheduled_prompt', text }
}

/** A session transcript, paged from the JSONL backwards — see `main/transcript/`. */

export type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  /** An image recorded in the session itself, carried as a data URL ready to render. */
  | { type: 'image'; dataUrl: string }
  /** Claude Code's own record that a turn ended (`system` `turn_duration`) — what its terminal
   *  shows as "✻ Brewed for 33s". Written by the terminal UI only, not in stream-json mode. */
  | { type: 'turn_end'; durationMs: number }
  /** The recap Claude Code writes when you come back to a session (`system` `away_summary`). */
  | { type: 'recap'; text: string }

export interface TranscriptMessage {
  uuid: string
  role: 'user' | 'assistant'
  timestampMs: number | null
  isSidechain: boolean
  blocks: TranscriptBlock[]
}

export interface TranscriptPage {
  messages: TranscriptMessage[]
  /** Byte offset to continue reading backwards from, or null when at the start. */
  earlierCursor: number | null
  skippedLines: number
}

/**
 * How many messages one transcript page holds. Shared so the real reader and the component fake
 * page identically (TEST-5: the fake paged at 50 while main paged at 200, so a component test of
 * "Load earlier messages" exercised a different boundary than the app).
 */
export const TRANSCRIPT_PAGE_SIZE = 200

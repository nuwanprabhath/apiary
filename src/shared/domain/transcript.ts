/** A session transcript, paged from the JSONL backwards — see `main/transcript/`. */

export type TranscriptBlock =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  /** An image recorded in the session itself, carried as a data URL ready to render. */
  | { type: 'image'; dataUrl: string }

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

import { open } from 'node:fs/promises'

export const DEFAULT_CHUNK_BYTES = 65536

async function readChunk(
  filePath: string,
  maxBytes: number,
  fromEnd: boolean,
): Promise<{ text: string; truncated: boolean }> {
  const handle = await open(filePath, 'r')
  try {
    const { size } = await handle.stat()
    const length = Math.min(maxBytes, size)
    const position = fromEnd ? size - length : 0
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, position)
    return { text: buffer.toString('utf8'), truncated: length < size }
  } finally {
    await handle.close()
  }
}

function splitLines(text: string): string[] {
  return text.split('\n').filter((line) => line.length > 0)
}

/** Complete lines from the start of the file. A trailing partial line is dropped. */
export async function readHeadLines(
  filePath: string,
  maxBytes: number = DEFAULT_CHUNK_BYTES,
): Promise<string[]> {
  const { text, truncated } = await readChunk(filePath, maxBytes, false)
  const lastNewline = text.lastIndexOf('\n')
  // When truncated, anything after the final newline is an incomplete line.
  const usable = truncated ? (lastNewline === -1 ? '' : text.slice(0, lastNewline)) : text
  return splitLines(usable)
}

/** Complete lines from the end of the file, in file order. A leading partial line is dropped. */
export async function readTailLines(
  filePath: string,
  maxBytes: number = DEFAULT_CHUNK_BYTES,
): Promise<string[]> {
  const { text, truncated } = await readChunk(filePath, maxBytes, true)
  const firstNewline = text.indexOf('\n')
  // When truncated, anything before the first newline is the tail of an earlier line.
  const usable = truncated ? (firstNewline === -1 ? '' : text.slice(firstNewline + 1)) : text
  return splitLines(usable)
}

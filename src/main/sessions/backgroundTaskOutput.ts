import { tmpdir } from 'node:os'
import { open } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { describeTool, type BackgroundTaskOutput } from '@shared/chatTimeline'
import { realPathInside } from '../fs/confine'
import { toMessage } from '../transcript/transcriptReader'

/** How much of the end of an output file is read: enough for the lines shown, never a whole log. */
export const TASK_OUTPUT_TAIL_BYTES = 32 * 1024
export const TASK_OUTPUT_LINES = 40
/** How much of an agent step's command shows when the step has no title of its own. */
const STEP_DETAIL_CHARS = 80

const UNAVAILABLE: BackgroundTaskOutput = { available: false, lines: [] }

export interface TaskOutputRoots {
  /** Where Claude Code puts its task folders (`<tmp>/claude-<uid>/<project>/<session>/tasks`): the
   *  OS temp dir and `/tmp`, which macOS keeps apart. */
  tempRoots: string[]
  /** Where a background agent's output file may point: its own transcript, under Claude Code's
   *  projects folder. */
  agentRoots: string[]
}

export function claudeTaskRoots(projectsDir: string): TaskOutputRoots {
  return { tempRoots: [tmpdir(), '/tmp'], agentRoots: [projectsDir] }
}

/**
 * The end of a background task's output, for the task popup. `declared` is the path the session
 * file says the task writes to (its start result), never anything the renderer sent. It is read only
 * when it is `<id>.output` in a `<session>/tasks` folder under one of the temp roots, by real path,
 * so a symlink out of that folder is refused — except an agent's, which Claude Code links to the
 * agent's transcript under its projects folder. Anything else is "not available", never an error.
 */
export async function readTaskOutput(
  declared: string, sessionId: string, taskId: string, kind: 'shell' | 'agent', roots: TaskOutputRoots,
): Promise<BackgroundTaskOutput> {
  const tasksDir = dirname(declared)
  if (basename(declared) !== `${taskId}.output` || basename(tasksDir) !== 'tasks' || basename(dirname(tasksDir)) !== sessionId) return UNAVAILABLE
  const insideTemp = await firstInside(roots.tempRoots, tasksDir)
  if (insideTemp === null) return UNAVAILABLE
  const real = await realPathInside(tasksDir, declared) ?? (kind === 'agent' ? await firstInside(roots.agentRoots, declared) : null)
  if (real === null) return UNAVAILABLE
  let text: string
  try {
    text = await readTail(real, TASK_OUTPUT_TAIL_BYTES)
  } catch {
    return UNAVAILABLE
  }
  return { available: true, lines: kind === 'agent' ? agentSteps(text) : shellLines(text) }
}

async function firstInside(roots: string[], path: string): Promise<string | null> {
  for (const root of roots) {
    const real = await realPathInside(root, path)
    if (real !== null) return real
  }
  return null
}

/** The last `bytes` of the file, starting at a whole line when it had to cut. */
async function readTail(path: string, bytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - bytes)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    const text = buffer.toString('utf8')
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1)
  } finally {
    await handle.close()
  }
}

/** Escape sequences (CSI, OSC, the two-byte ones) and other control bytes, which a terminal would
 *  draw and a text box shows as noise. A carriage return keeps only what was drawn last on its line. */
function stripControls(text: string): string {
  const ESC = 0x1b
  let out = ''
  let i = 0
  while (i < text.length) {
    const c = text.charCodeAt(i)
    if (c === ESC) {
      const kind = text[i + 1]
      i += 2
      if (kind === '[') {
        // CSI: parameters and intermediates, then one final byte in @–~.
        while (i < text.length && !(text.charCodeAt(i) >= 0x40 && text.charCodeAt(i) <= 0x7e)) i++
        i++
      } else if (kind === ']') {
        // OSC: up to BEL or ESC \.
        while (i < text.length && text.charCodeAt(i) !== 0x07 && text.charCodeAt(i) !== ESC) i++
        i += text.charCodeAt(i) === ESC ? 2 : 1
      }
      continue
    }
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) { i++; continue }
    out += text[i]
    i++
  }
  return out
}

function shellLines(text: string): string[] {
  const lines = text.split('\n').map((line) => {
    const drawn = line.split('\r').filter((p) => p !== '')
    return stripControls(drawn.length === 0 ? '' : drawn[drawn.length - 1]).trimEnd()
  })
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines.slice(-TASK_OUTPUT_LINES)
}

/** An agent's transcript as its latest steps: what it said, and each tool it ran with its title. */
function agentSteps(text: string): string[] {
  const steps: string[] = []
  for (const line of text.split('\n')) {
    let entry: unknown
    try { entry = JSON.parse(line) } catch { continue }
    if (entry === null || typeof entry !== 'object') continue
    const message = toMessage(entry as Record<string, unknown>)
    if (message === null || message.role !== 'assistant') continue
    for (const b of message.blocks) {
      if (b.type === 'text') steps.push(...b.text.split('\n').map((l) => l.trimEnd()).filter((l) => l !== ''))
      else if (b.type === 'tool_use') {
        const { title, input } = describeTool(b.name, b.input)
        const what = title !== '' ? title : (input.split('\n')[0] ?? '').slice(0, STEP_DETAIL_CHARS)
        steps.push(what === '' ? `→ ${b.name}` : `→ ${b.name}  ${what}`)
      }
    }
  }
  return steps.map(stripControls).slice(-TASK_OUTPUT_LINES)
}

import {
  PALETTE_TOKENS, TERMINAL_COLORS, UI_FONTS, MONO_FONTS, EFFECT_KINDS, DENSITIES, MATERIALS, LIMITS,
  type ThemeSpec,
} from './spec'
import { BUILTIN_THEMES } from './builtins'

/**
 * What Claude is asked, and how its answer is read back.
 *
 * The schema is generated from the same allowlists the validator enforces, so the two cannot
 * drift: Claude is told exactly the names it may use. It is still only a request — the reply goes
 * through `validateTheme` like anything else, and whatever the schema did not stop, that does.
 */

const EFFECT_NOTES: Record<string, string> = {
  'digital-rain': 'falling columns of glyphs behind the panels (Matrix)',
  'perspective-grid': 'a synthwave floor of lines rolling to a horizon, behind the panels',
  'starfield': 'drifting, twinkling stars behind the panels',
  'noise': 'fine film grain behind the panels',
  'gradient-drift': 'two soft pools of colour wandering behind the panels',
  'aurora': 'big slow pools of saturated colour, like a macOS wallpaper — the thing to put behind glass panels',
  'scanlines': 'faint CRT scanlines over everything',
  'crt-vignette': 'darkened corners like an old tube, over everything',
  'neon-glow': 'a glow of the chosen colour around every panel edge',
  'glitch-flicker': 'a rare, brief tear across the screen',
  'paper-grain': 'a still, faint paper texture over everything',
}

const FONT_NOTES: Record<string, string> = {
  'system': 'the platform UI font', 'inter': 'clean modern sans', 'ibm-plex-sans': 'technical, friendly sans',
  'space-grotesk': 'geometric, slightly quirky sans', 'orbitron': 'wide sci-fi display face (use for bold themes)',
  'rajdhani': 'condensed, angular sans', 'system-mono': 'the platform monospace', 'jetbrains-mono': 'modern coding mono',
  'ibm-plex-mono': 'typewriter-like mono', 'fira-code': 'coding mono', 'vt323': 'pixel CRT terminal mono',
  'share-tech-mono': 'narrow sci-fi terminal mono',
}

interface ColorMapSchema { type: 'object'; properties: Record<string, { type: 'string'; pattern: string }>; additionalProperties: false }

const colorMap = (names: readonly string[]): ColorMapSchema => ({
  type: 'object',
  properties: Object.fromEntries(names.map((n) => [n, { type: 'string' as const, pattern: '^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$' }])),
  additionalProperties: false,
})

export const THEME_JSON_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string', maxLength: LIMITS.maxNameChars },
    palette: colorMap(PALETTE_TOKENS),
    terminal: colorMap(TERMINAL_COLORS),
    shape: {
      type: 'object',
      properties: {
        radius: { type: 'number', minimum: LIMITS.radius.min, maximum: LIMITS.radius.max },
        gap: { type: 'number', minimum: LIMITS.gap.min, maximum: LIMITS.gap.max },
        density: { type: 'string', enum: [...DENSITIES] },
      },
      required: ['radius', 'gap', 'density'],
      additionalProperties: false,
    },
    font: {
      type: 'object',
      properties: { ui: { type: 'string', enum: [...UI_FONTS] }, mono: { type: 'string', enum: [...MONO_FONTS] } },
      required: ['ui', 'mono'],
      additionalProperties: false,
    },
    effects: {
      type: 'array',
      maxItems: LIMITS.maxEffects,
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: [...EFFECT_KINDS] },
          color: { type: 'string', enum: [...PALETTE_TOKENS] },
          intensity: { type: 'number', minimum: 0, maximum: 1 },
          speed: { type: 'number', minimum: 0, maximum: 1 },
          density: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: ['kind', 'intensity', 'speed', 'density'],
        additionalProperties: false,
      },
    },
    material: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...MATERIALS] },
        blur: { type: 'number', minimum: LIMITS.blur.min, maximum: LIMITS.blur.max },
        saturation: { type: 'number', minimum: LIMITS.saturation.min, maximum: LIMITS.saturation.max },
        highlight: { type: 'number', minimum: 0, maximum: 1 },
        refraction: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['kind', 'blur', 'saturation', 'highlight', 'refraction'],
      additionalProperties: false,
    },
  },
  required: ['name', 'palette', 'terminal', 'shape', 'font', 'effects', 'material'],
  additionalProperties: false,
} as const

export const MAX_REQUEST_CHARS = 2000

export function buildThemePrompt({ request, current }: { request: string; current: ThemeSpec | null }): string {
  const clipped = request.slice(0, MAX_REQUEST_CHARS)
  const examples = BUILTIN_THEMES.map((b) => JSON.stringify({ ...b.spec, version: undefined })).join('\n')
  return [
    'You design colour themes for Apiary, a desktop app for browsing and running Claude Code sessions.',
    'Reply with one theme as JSON matching the provided schema, and nothing else.',
    '',
    'The app: a sidebar of sessions, editor panes showing a transcript or a terminal, a shell panel under each pane.',
    'Panels are rounded cards on a window background ("bg-window"), a gap apart.',
    '',
    'Palette tokens (all optional; omit any you do not need to change):',
    '- bg-window: behind the panels. bg: the transcript and editor surface. bg-panel: sidebar, tab strips, toolbars.',
    '- bg-terminal: terminals. bg-overlay: dim behind dialogs. border, text, muted (secondary text), accent (buttons, highlights),',
    '  accent-contrast (text on an accent fill), selected, hover, danger/success/warning/info, mr-merged,',
    '  control-bg (buttons), field-bg (inputs), scrollbar-thumb(-hover), handle-color(-active) (resize grips).',
    '',
    'Rules:',
    '- Colours as #rrggbb or #rrggbbaa.',
    '- Text must be clearly readable on bg, bg-panel and control-bg; muted and accent readable on bg-panel.',
    '- Material "solid": bg and bg-terminal opaque; bg-panel and control-bg may be translucent (alpha >= 0.6) so background effects show through.',
    '- Material "glass": the panels are panes of glass over the window — see-through and blurred. Use it for glass, frosted, translucent,',
    '  acrylic, vibrancy or macOS "liquid glass" requests. Then bg, bg-panel, bg-terminal, control-bg and field-bg should be translucent',
    '  (#rrggbbaa, about 0x40-0x90 alpha for bg and bg-panel; control-bg and selected as light washes like #ffffff1f), and put a colourful',
    '  background effect behind them (aurora, gradient-drift or starfield) or the glass has nothing to show. blur 8-40 px (frosted: 20-32),',
    '  saturation 1-2 (liquid glass about 1.8), highlight 0-1 (bright rim and sheen; liquid glass 0.7-1), refraction 0-1 (a bright lens-like band',
    '  inside each pane edge; liquid glass 0.4-0.7, frosted 0). Apiary thickens any pane whose text would be hard to read.',
    '  What shows through the glass is bg-window plus the background effect, so they decide how the glass reads: light glass',
    '  (dark text, white-ish panes) needs a light bg-window and a pale effect colour; dark glass (light text) needs a dark bg-window.',
    '  Keep panes translucent enough to see through (alpha at least 0x40) — a pane Apiary has to thicken to opaque is no longer glass.',
    '- For a solid theme use material {"kind":"solid","blur":0,"saturation":1,"highlight":0,"refraction":0}.',
    '- Give a full terminal palette (16 ANSI colours plus foreground, background, cursor, selection) that fits the theme.',
    '- At most 3 effects; keep intensities moderate so the app stays usable. Effect "color" names a palette token.',
    '- name: a short evocative theme name.',
    '',
    'Fonts (ui / mono):',
    ...[...UI_FONTS, ...MONO_FONTS].map((f) => `- ${f}: ${FONT_NOTES[f]}`),
    '',
    'Effects:',
    ...EFFECT_KINDS.map((e) => `- ${e}: ${EFFECT_NOTES[e]}`),
    '',
    'Examples of good themes:',
    examples,
    '',
    ...(current !== null
      ? ['The current theme, to adjust as asked (return the whole adjusted theme):', JSON.stringify({ ...current, version: undefined }), '', 'Adjustment requested:']
      : ['Theme requested:']),
    clipped,
  ].join('\n')
}

/** The first balanced `{…}` in `text`, honouring strings, or null. */
function firstObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i += 1) {
    const c = text[i]
    if (inString) {
      if (c === '\\') i += 1
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth += 1
    else if (c === '}') { depth -= 1; if (depth === 0) return text.slice(start, i + 1) }
  }
  return null
}

function parse(text: string): unknown {
  try { return JSON.parse(text) } catch { return undefined }
}

/**
 * The theme object in `claude -p --output-format json` output, or null. `structured_output` is
 * what `--json-schema` produces; `result` is the fallback, as bare JSON, a fenced block, or an
 * object somewhere in prose.
 */
export function extractThemeJson(stdout: string): unknown {
  const envelope = parse(stdout.trim())
  if (typeof envelope !== 'object' || envelope === null) return null
  const e = envelope as Record<string, unknown>
  if (e.is_error === true) return null
  if (typeof e.structured_output === 'object' && e.structured_output !== null) return e.structured_output
  if (typeof e.result !== 'string') return null
  const text = e.result
  const direct = parse(text.trim())
  if (typeof direct === 'object' && direct !== null) return direct
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  if (fenced !== null) {
    const f = parse(fenced[1].trim())
    if (typeof f === 'object' && f !== null) return f
  }
  const obj = firstObject(text)
  const o = obj === null ? undefined : parse(obj)
  return typeof o === 'object' && o !== null ? o : null
}

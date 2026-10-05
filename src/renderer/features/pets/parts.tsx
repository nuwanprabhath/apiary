import type { JSX } from 'react'
import type { Accessory, BodyShape, EyeStyle, PetSpec } from '@shared/pets/spec'
import type { Activity, Face } from '@shared/pets/brain'

/**
 * Apiary's library of pet parts. Every pet is drawn from these in a 100×100 box (feet at the
 * bottom); a pet only chooses which parts and their colours, already validated as `#rrggbb`. All
 * the drawing — every path — is Apiary's own. The fixed colours here (blush, book pages, the
 * sparkle) belong to the part, not to any theme.
 */

/** Where things sit on each body: its top (hats), eye line, shoulders, bottom (legs). */
interface Frame { top: number; eyes: number; shoulder: [number, number]; bottom: number }

const FRAMES: Record<BodyShape, Frame> = {
  blob: { top: 25, eyes: 51, shoulder: [17, 83], bottom: 87 },
  bean: { top: 22, eyes: 49, shoulder: [21, 79], bottom: 88 },
  drop: { top: 30, eyes: 59, shoulder: [20, 80], bottom: 88 },
  heart: { top: 27, eyes: 47, shoulder: [18, 82], bottom: 84 },
  star: { top: 24, eyes: 57, shoulder: [19, 81], bottom: 86 },
  ghost: { top: 24, eyes: 50, shoulder: [21, 79], bottom: 86 },
  puff: { top: 27, eyes: 56, shoulder: [16, 84], bottom: 87 },
  cube: { top: 28, eyes: 54, shoulder: [19, 81], bottom: 88 },
}

export function frameOf(shape: BodyShape): Frame { return FRAMES[shape] }

// -- colour helpers (inputs are validated #rrggbb)

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}
/** Towards black by `amount` (0..1). */
export function shade(hex: string, amount: number): string {
  return toHex(rgb(hex).map((v) => v * (1 - amount)) as [number, number, number])
}
/** Towards white by `amount` (0..1). */
export function tint(hex: string, amount: number): string {
  return toHex(rgb(hex).map((v) => v + (255 - v) * amount) as [number, number, number])
}

function starPath(cx: number, cy: number, outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)} ${(cy + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${pts.join(' L')} Z`
}

const BODY_PATHS: Record<Exclude<BodyShape, 'puff' | 'cube'>, string> = {
  blob: 'M48 25 C62 22 74 28 80 38 C88 50 86 66 80 76 C73 86 60 89 49 88 C36 88 24 84 18 74 C12 62 14 46 21 37 C28 29 38 26 48 25 Z',
  bean: 'M50 22 C68 22 80 36 80 55 C80 76 67 89 50 89 C33 89 20 76 20 55 C20 36 32 22 50 22 Z',
  drop: 'M50 28 C57 38 82 50 82 65 C82 80 68 89 50 89 C32 89 18 80 18 65 C18 50 43 38 50 28 Z',
  heart: 'M50 85 C40 78 16 64 16 45 C16 33 25 25 35 25 C42 25 47 29 50 34 C53 29 58 25 65 25 C75 25 84 33 84 45 C84 64 60 78 50 85 Z',
  star: starPath(50, 57, 37, 21),
  ghost: 'M21 56 C21 37 34 24 50 24 C66 24 79 37 79 56 L79 86 C75 82 71 82 67 86 C63 90 59 90 55 86 C51 82 47 82 43 86 C39 90 35 90 31 86 C27 82 23 82 21 86 Z',
}

/** The body: shape, shading and texture, with the shadow it casts on the glass beneath it. */
export function Body({ spec, uid }: { spec: PetSpec; uid: string }): JSX.Element {
  const { shape, color, accent, texture } = spec.body
  const fill = `url(#${uid}-fill)`
  const filter = texture === 'fuzzy' ? `url(#${uid}-fuzz)` : undefined
  // A star's and a drop's points are softened by a stroke of the same fill, rounded at the joins.
  const soft = shape === 'star' || shape === 'drop' ? { stroke: fill, strokeWidth: 7, strokeLinejoin: 'round' as const } : {}
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <defs>
        <radialGradient id={`${uid}-fill`} gradientUnits="userSpaceOnUse" cx="40" cy="38" r="58">
          <stop offset="0" stopColor={tint(accent, 0.25)} />
          <stop offset="0.45" stopColor={color} />
          <stop offset="1" stopColor={shade(color, 0.32)} />
        </radialGradient>
        {texture === 'fuzzy' && (
          <filter id={`${uid}-fuzz`} x="-10%" y="-10%" width="120%" height="120%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="4" />
            <feDisplacementMap in="SourceGraphic" scale="3.2" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        )}
      </defs>
      <g filter={filter}>
        {shape === 'puff' && (
          <g fill={fill}>
            <circle cx="33" cy="62" r="18" /><circle cx="50" cy="47" r="22" /><circle cx="67" cy="62" r="18" /><circle cx="50" cy="70" r="18" />
          </g>
        )}
        {shape === 'cube' && <rect x="18" y="28" width="64" height="60" rx="17" fill={fill} />}
        {shape !== 'puff' && shape !== 'cube' && <path d={BODY_PATHS[shape]} fill={fill} {...soft} />}
      </g>
      {texture === 'glossy' && <ellipse cx="37" cy="38" rx="10" ry="5.5" fill="#ffffff" opacity="0.55" transform="rotate(-30 37 38)" />}
      {texture === 'matte' && <ellipse cx="40" cy="38" rx="12" ry="7" fill="#ffffff" opacity="0.12" transform="rotate(-25 40 38)" />}
    </svg>
  )
}

export function Shadow(): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <ellipse cx="50" cy="97" rx="25" ry="3.6" fill="#000000" opacity="0.38" />
      <ellipse cx="50" cy="97" rx="15" ry="2.2" fill="#000000" opacity="0.3" />
    </svg>
  )
}

export function Leg({ spec, side }: { spec: PetSpec; side: 'l' | 'r' }): JSX.Element {
  const { bottom } = FRAMES[spec.body.shape]
  const x = side === 'l' ? 40 : 60
  const tone = shade(spec.body.color, 0.25)
  const top = bottom - 5
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {spec.legs === 'stubby' && <rect x={x - 5.5} y={top} width="11" height={97 - top} rx="5.5" fill={tone} />}
      {spec.legs === 'feet' && (
        <>
          <rect x={x - 2} y={top} width="4" height={95 - top} rx="2" fill={tone} />
          <ellipse cx={x + (side === 'l' ? -2 : 2)} cy="95" rx="6.5" ry="3" fill={tone} />
        </>
      )}
      {spec.legs === 'boots' && (
        <>
          <rect x={x - 3} y={top} width="6" height="8" rx="3" fill={tone} />
          <rect x={side === 'l' ? x - 8 : x - 5} y="89" width="13" height="8" rx="3.5" fill={spec.eyes.color} />
          <rect x={x - 6} y="88" width="12" height="2.4" rx="1.2" fill={tint(spec.eyes.color, 0.35)} />
        </>
      )}
    </svg>
  )
}

export function Arm({ spec, side }: { spec: PetSpec; side: 'l' | 'r' }): JSX.Element {
  const f = FRAMES[spec.body.shape]
  const sx = side === 'l' ? f.shoulder[0] : f.shoulder[1]
  const sy = f.eyes + 13
  const dir = side === 'l' ? -1 : 1
  const tone = shade(spec.body.color, 0.12)
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {spec.arms === 'nub' && <ellipse cx={sx + dir * 2} cy={sy + 3} rx="6" ry="8.5" fill={tone} transform={`rotate(${String(dir * 28)} ${String(sx + dir * 2)} ${String(sy + 3)})`} />}
      {spec.arms === 'noodle' && (
        <>
          <path d={`M${String(sx)} ${String(sy)} Q${String(sx + dir * 11)} ${String(sy + 4)} ${String(sx + dir * 9)} ${String(sy + 15)}`} stroke={tone} strokeWidth="4.5" strokeLinecap="round" fill="none" />
          <circle cx={sx + dir * 9} cy={sy + 15} r="3.6" fill={tone} />
        </>
      )}
      {spec.arms === 'mitten' && (
        <>
          <ellipse cx={sx + dir * 4} cy={sy + 5} rx="6.5" ry="8.5" fill={tone} transform={`rotate(${String(dir * 20)} ${String(sx + dir * 4)} ${String(sy + 5)})`} />
          <circle cx={sx + dir * 9} cy={sy + 2} r="3" fill={tone} />
        </>
      )}
    </svg>
  )
}

/** Shoulder, as a CSS transform-origin, so an arm waves from where it joins the body. */
export function shoulderOrigin(spec: PetSpec, side: 'l' | 'r'): string {
  const f = FRAMES[spec.body.shape]
  return `${String(side === 'l' ? f.shoulder[0] : f.shoulder[1])}% ${String(f.eyes + 13)}%`
}

const EYE_X = [39, 61] as const

function Heart({ cx, cy }: { cx: number; cy: number }): JSX.Element {
  return <path d={`M${String(cx)} ${String(cy + 5)} C${String(cx - 7)} ${String(cy)} ${String(cx - 6)} ${String(cy - 6)} ${String(cx - 2.5)} ${String(cy - 5)} C${String(cx - 1)} ${String(cy - 5)} ${String(cx)} ${String(cy - 3.5)} ${String(cx)} ${String(cy - 3.5)} C${String(cx)} ${String(cy - 3.5)} ${String(cx + 1)} ${String(cy - 5)} ${String(cx + 2.5)} ${String(cy - 5)} C${String(cx + 6)} ${String(cy - 6)} ${String(cx + 7)} ${String(cy)} ${String(cx)} ${String(cy + 5)} Z`} fill="#ff4f81" />
}

function Eye({ style, face, cx, cy, ink, lid }: { style: EyeStyle; face: Face; cx: number; cy: number; ink: string; lid: string }): JSX.Element {
  if (face === 'sleepy') return <path d={`M${String(cx - 6)} ${String(cy)} Q${String(cx)} ${String(cy + 4.5)} ${String(cx + 6)} ${String(cy)}`} stroke={ink} strokeWidth="2.4" strokeLinecap="round" fill="none" />
  if (face === 'love') return <Heart cx={cx} cy={cy} />
  // Looking up at Claude while it works; wide-eyed when surprised.
  const dx = face === 'focused' ? 1.2 : 0
  const dy = face === 'focused' ? -2.6 : 0
  const pupil = face === 'surprised' ? 3 : 5
  switch (style) {
    case 'round':
      return (
        <g>
          <circle cx={cx} cy={cy} r={face === 'surprised' ? 9.5 : 8.5} fill="#ffffff" />
          <circle cx={cx + dx} cy={cy + 1 + dy} r={pupil + 0.3} fill={ink} />
          <circle cx={cx + dx - 2} cy={cy - 1.4 + dy} r="1.9" fill="#ffffff" />
          <circle cx={cx + dx + 1.8} cy={cy + 2.6 + dy} r="0.9" fill="#ffffff" />
        </g>
      )
    case 'wide':
      return (
        <g>
          <ellipse cx={cx} cy={cy} rx="8" ry="10" fill="#ffffff" />
          <circle cx={cx + dx} cy={cy + 1 + dy} r={pupil - 0.6} fill={ink} />
          <circle cx={cx + dx - 1.5} cy={cy - 0.6 + dy} r="1.3" fill="#ffffff" />
        </g>
      )
    case 'button':
      return (
        <g>
          <circle cx={cx + dx} cy={cy + dy} r={face === 'surprised' ? 6.5 : 5.5} fill={ink} />
          <circle cx={cx + dx - 1.8} cy={cy - 1.8 + dy} r="1.7" fill="#ffffff" />
        </g>
      )
    case 'sparkle':
      return (
        <g>
          <circle cx={cx + dx} cy={cy + dy} r="7" fill={ink} />
          <circle cx={cx + dx - 2.2} cy={cy - 2.4 + dy} r="2.5" fill="#ffffff" />
          <circle cx={cx + dx + 2.4} cy={cy + 2.2 + dy} r="1.2" fill="#ffffff" />
          <circle cx={cx + dx + 2.6} cy={cy - 3} r="0.7" fill="#ffffff" opacity="0.8" />
        </g>
      )
    case 'sleepy':
      return (
        <g>
          <circle cx={cx + dx} cy={cy + 1 + dy} r="5.2" fill={ink} />
          <circle cx={cx + dx - 1.6} cy={cy + dy} r="1.4" fill="#ffffff" />
          {/* A heavy lid in the body's colour over the top half. */}
          <path d={`M${String(cx - 7)} ${String(cy + 0.5)} Q${String(cx)} ${String(cy - 9)} ${String(cx + 7)} ${String(cy + 0.5)} Z`} fill={lid} />
          <path d={`M${String(cx - 6.5)} ${String(cy + 0.5)} L${String(cx + 6.5)} ${String(cy + 0.5)}`} stroke={ink} strokeWidth="1.4" strokeLinecap="round" />
        </g>
      )
  }
}

export function Eyes({ spec, face }: { spec: PetSpec; face: Face }): JSX.Element {
  const cy = FRAMES[spec.body.shape].eyes
  const ink = spec.eyes.color
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {EYE_X.map((cx) => <Eye key={cx} style={spec.eyes.style} face={face} cx={cx} cy={cy} ink={ink} lid={shade(spec.body.color, 0.05)} />)}
      {face === 'worried' && (
        <g stroke={ink} strokeWidth="2" strokeLinecap="round">
          <path d={`M31 ${String(cy - 13)} L44 ${String(cy - 10)}`} />
          <path d={`M69 ${String(cy - 13)} L56 ${String(cy - 10)}`} />
        </g>
      )}
    </svg>
  )
}

type Mouth = Face | 'open'

export function mouthFor(face: Face, activity: Activity): Mouth {
  return activity === 'celebrate' || activity === 'dance' ? 'open' : face
}

export function Mouth({ spec, mouth }: { spec: PetSpec; mouth: Mouth }): JSX.Element {
  const e = FRAMES[spec.body.shape].eyes
  const m = e + 12
  const ink = spec.eyes.color
  const S = String
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true">
      {spec.cheeks && (
        <g fill="#ff7aa2" opacity={mouth === 'love' ? 0.8 : 0.55}>
          <ellipse cx="29" cy={e + 9} rx="5.2" ry="3" />
          <ellipse cx="71" cy={e + 9} rx="5.2" ry="3" />
        </g>
      )}
      {(mouth === 'happy' || mouth === 'love') && <path d={`M45 ${S(m)} Q50 ${S(m + 5)} 55 ${S(m)}`} stroke={ink} strokeWidth="2.2" strokeLinecap="round" fill="none" />}
      {mouth === 'open' && (
        <g>
          <path d={`M43 ${S(m - 1)} Q50 ${S(m + 10)} 57 ${S(m - 1)} Z`} fill={ink} />
          <ellipse cx="50" cy={m + 4.2} rx="3.2" ry="1.8" fill="#ff7a9a" />
        </g>
      )}
      {mouth === 'surprised' && <ellipse cx="50" cy={m + 2} rx="3" ry="3.8" fill={ink} />}
      {mouth === 'focused' && <path d={`M47 ${S(m + 1)} L53 ${S(m + 1)}`} stroke={ink} strokeWidth="2.2" strokeLinecap="round" />}
      {mouth === 'sleepy' && <circle cx="50" cy={m + 1.5} r="1.9" fill={ink} />}
      {mouth === 'worried' && <path d={`M44 ${S(m + 2)} Q47 ${S(m)} 50 ${S(m + 2)} Q53 ${S(m + 4)} 56 ${S(m + 2)}`} stroke={ink} strokeWidth="2" strokeLinecap="round" fill="none" />}
    </svg>
  )
}

function AccessoryPart({ kind, color, spec }: { kind: Accessory; color: string; spec: PetSpec }): JSX.Element {
  const f = FRAMES[spec.body.shape]
  const T = f.top
  const E = f.eyes
  const N = f.bottom - 8
  const S = String
  const dark = shade(color, 0.3)
  switch (kind) {
    case 'beret':
      return (
        <g transform={`rotate(-12 50 ${S(T + 2)})`}>
          <ellipse cx="50" cy={T + 2} rx="23" ry="8.5" fill={color} />
          <path d={`M28 ${S(T + 4)} Q50 ${S(T + 10)} 72 ${S(T + 4)}`} stroke={dark} strokeWidth="1.6" fill="none" />
          <circle cx="51" cy={T - 7} r="3" fill={color} />
        </g>
      )
    case 'cap':
      return (
        <g>
          <path d={`M29 ${S(T + 7)} C29 ${S(T - 12)} 71 ${S(T - 12)} 71 ${S(T + 7)} Z`} fill={color} />
          <ellipse cx="76" cy={T + 6} rx="16" ry="4" fill={dark} />
          <circle cx="50" cy={T - 7} r="2.4" fill={dark} />
        </g>
      )
    case 'beanie':
      return (
        <g>
          <path d={`M27 ${S(T + 8)} C27 ${S(T - 15)} 73 ${S(T - 15)} 73 ${S(T + 8)} Z`} fill={color} />
          <rect x="25" y={T + 1} width="50" height="9" rx="4.5" fill={dark} />
          <circle cx="50" cy={T - 11} r="6" fill={tint(color, 0.45)} />
        </g>
      )
    case 'crown':
      return (
        <g>
          <path d={`M34 ${S(T + 4)} L34 ${S(T - 8)} L42 ${S(T - 1)} L50 ${S(T - 13)} L58 ${S(T - 1)} L66 ${S(T - 8)} L66 ${S(T + 4)} Z`} fill={color} stroke={dark} strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="50" cy={T - 1} r="2.2" fill="#ffffff" opacity="0.9" />
          <circle cx="40" cy={T + 1} r="1.5" fill="#ffffff" opacity="0.7" />
          <circle cx="60" cy={T + 1} r="1.5" fill="#ffffff" opacity="0.7" />
        </g>
      )
    case 'flower':
      return (
        <g transform={`translate(66 ${S(T + 1)})`}>
          {[0, 72, 144, 216, 288].map((a) => <circle key={a} cx={6 * Math.cos((a * Math.PI) / 180)} cy={6 * Math.sin((a * Math.PI) / 180)} r="4.6" fill={color} />)}
          <circle r="3.6" fill="#fff3b0" />
        </g>
      )
    case 'headphones':
      return (
        <g>
          <path d={`M19 ${S(E - 2)} C19 ${S(T - 16)} 81 ${S(T - 16)} 81 ${S(E - 2)}`} stroke={color} strokeWidth="5" fill="none" strokeLinecap="round" />
          <rect x="11" y={E - 9} width="10" height="17" rx="5" fill={color} />
          <rect x="79" y={E - 9} width="10" height="17" rx="5" fill={color} />
        </g>
      )
    case 'round-glasses':
      return (
        <g stroke={color} strokeWidth="2.6" fill="#ffffff" fillOpacity="0.12">
          <circle cx="39" cy={E} r="10.5" />
          <circle cx="61" cy={E} r="10.5" />
          <path d={`M49.5 ${S(E - 1)} Q50 ${S(E - 3)} 50.5 ${S(E - 1)}`} fill="none" />
        </g>
      )
    case 'sunglasses':
      return (
        <g>
          <rect x="27" y={E - 7} width="21" height="13" rx="5" fill={color} />
          <rect x="52" y={E - 7} width="21" height="13" rx="5" fill={color} />
          <path d={`M48 ${S(E - 3)} L52 ${S(E - 3)}`} stroke={color} strokeWidth="2.4" />
          <path d={`M31 ${S(E - 3)} L36 ${S(E - 5)}`} stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
          <path d={`M56 ${S(E - 3)} L61 ${S(E - 5)}`} stroke="#ffffff" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
        </g>
      )
    case 'monocle':
      return (
        <g fill="none" stroke={color} strokeWidth="2.4">
          <circle cx="61" cy={E} r="10.5" fill="#ffffff" fillOpacity="0.15" />
          <path d={`M70 ${S(E + 7)} Q78 ${S(E + 18)} 74 ${S(N)}`} strokeWidth="1.2" strokeDasharray="1.5 1.5" />
        </g>
      )
    case 'bowtie':
      return (
        <g fill={color}>
          <path d={`M50 ${S(N)} L37 ${S(N - 7)} L37 ${S(N + 7)} Z`} strokeLinejoin="round" stroke={color} strokeWidth="2" />
          <path d={`M50 ${S(N)} L63 ${S(N - 7)} L63 ${S(N + 7)} Z`} strokeLinejoin="round" stroke={color} strokeWidth="2" />
          <circle cx="50" cy={N} r="3.4" fill={dark} />
        </g>
      )
    case 'scarf':
      return (
        <g>
          <rect x="27" y={N - 6} width="46" height="10" rx="5" fill={color} />
          <rect x="58" y={N} width="10" height="15" rx="3.5" fill={color} transform={`rotate(12 63 ${S(N)})`} />
          <path d={`M32 ${S(N - 1)} L68 ${S(N - 1)}`} stroke={dark} strokeWidth="1.2" strokeDasharray="3 3" />
        </g>
      )
  }
}

export function Accessories({ spec }: { spec: PetSpec }): JSX.Element | null {
  if (spec.accessories.length === 0) return null
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" overflow="visible">
      {spec.accessories.map((a) => <AccessoryPart key={a.kind} kind={a.kind} color={a.color} spec={spec} />)}
    </svg>
  )
}

/** What a pet holds or has about it while doing something: a book, Zzz, a sweat drop, sparkles. */
export function Props({ spec, activity }: { spec: PetSpec; activity: Activity }): JSX.Element | null {
  const f = FRAMES[spec.body.shape]
  if (activity === 'read') {
    const y = f.eyes + 16
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d={`M30 ${String(y)} L50 ${String(y + 4)} L70 ${String(y)} L70 ${String(y + 15)} L50 ${String(y + 19)} L30 ${String(y + 15)} Z`} fill={shade(spec.body.accent, 0.35)} />
        <path d={`M32 ${String(y - 1)} L50 ${String(y + 3)} L50 ${String(y + 17)} L32 ${String(y + 13)} Z`} fill="#fdf6e3" />
        <path d={`M68 ${String(y - 1)} L50 ${String(y + 3)} L50 ${String(y + 17)} L68 ${String(y + 13)} Z`} fill="#f4ead2" />
      </svg>
    )
  }
  if (activity === 'nervous') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <path d={`M80 ${String(f.top + 8)} Q76 ${String(f.top + 15)} 80 ${String(f.top + 17)} Q84 ${String(f.top + 15)} 80 ${String(f.top + 8)} Z`} fill="#8fd3ff" />
      </svg>
    )
  }
  if (activity === 'celebrate' || activity === 'dance') {
    return (
      <svg viewBox="0 0 100 100" aria-hidden="true" overflow="visible">
        <path d="M14 20 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2 Z" fill="#ffd84d" />
        <path d="M86 14 l1.5 4 4 1.5 -4 1.5 -1.5 4 -1.5 -4 -4 -1.5 4 -1.5 Z" fill="#7ef0ff" />
        <path d="M84 40 l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1 Z" fill="#ff8ad8" />
      </svg>
    )
  }
  return null
}

export function Zzz(): JSX.Element {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" overflow="visible">
      <g fill="none" stroke="#e8edff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path className="pet-z pet-z1" d="M72 30 h8 l-8 9 h8" />
        <path className="pet-z pet-z2" d="M84 14 h6 l-6 7 h6" />
      </g>
    </svg>
  )
}

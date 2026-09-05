/**
 * Regenerates the Apiary app icon from its parametric source.
 *
 * Writes `build/icon.svg` (the master), then rasterises everything electron-builder and the
 * runtime need:
 *   build/icon.png      1024px, the source electron-builder falls back to for any platform
 *   build/icon.icns     macOS bundle icon (needs `iconutil`, so macOS only — skipped elsewhere)
 *   build/icons/*.png   per-size PNGs, which is the form electron-builder wants for Linux
 *
 * Rasterising needs `rsvg-convert` (brew install librsvg / apt install librsvg2-bin). The SVG
 * itself is written regardless, so a machine without it still gets an up-to-date master.
 *
 * Run with: npm run icons
 */
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, 'build')

// --- design ---------------------------------------------------------------
const SIZE = 512
const CX = SIZE / 2
const CY = SIZE / 2

const COMB = '#FEE404'   // comb lines and the rim band
const SPOKE = '#FEBD02'  // the six-spoke mark in the centre cell
const EDGE = '#A87200'   // see the note on `edgeW` below
const WHITE = '#FFFFFF'

const OUTER_R = 226
const RIM_W = 18
const CELL_R = 66
const COMB_W = 7.5
const SPOKE_W = 11
const SPOKE_LEN = 38
/**
 * A deeper amber drawn *underneath* every yellow stroke, and along both edges of the rim band,
 * purely so the shape survives on a white surface: #FEE404 on white measures 1.29:1, far under
 * the 3:1 WCAG asks of a graphical element, so unaided the comb lines all but disappear against
 * the icon's own white body. This edge is not a second brand colour — it reads as an outline.
 */
const EDGE_W = 2.5

/** Flat-top hexagon (flat edge across the top): vertices at 0, 60, ... 300 degrees. */
function hexPath(cx, cy, r) {
  const pts = []
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i)
    pts.push([(cx + r * Math.cos(a)).toFixed(2), (cy + r * Math.sin(a)).toFixed(2)])
  }
  return 'M ' + pts.map((p) => p.join(',')).join(' L ') + ' Z'
}

/** The centre cell plus its six edge-sharing neighbours (apothem directions, 30deg offset). */
function rosette(cx, cy, cellR) {
  const d = cellR * Math.sqrt(3)
  const centers = [[cx, cy]]
  for (const deg of [30, 90, 150, 210, 270, 330]) {
    const a = (Math.PI / 180) * deg
    centers.push([cx + d * Math.cos(a), cy + d * Math.sin(a)])
  }
  return centers
}

/** Three lines crossing at the centre, i.e. six spokes aimed at the centre cell's vertices. */
function spokes(cx, cy, len) {
  const n = (v) => Number(v.toFixed(2))
  return [0, 60, 120].map((deg) => {
    const a = (Math.PI / 180) * deg
    const dx = len * Math.cos(a)
    const dy = len * Math.sin(a)
    return `M ${n(cx - dx)} ${n(cy - dy)} L ${n(cx + dx)} ${n(cy + dy)}`
  })
}

function buildSvg() {
  const cells = rosette(CX, CY, CELL_R).map(([x, y]) => hexPath(x, y, CELL_R))
  const rays = spokes(CX, CY, SPOKE_LEN)

  return `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${COMB}" />
      <stop offset="1" stop-color="${SPOKE}" />
    </linearGradient>
  </defs>

  <path d="${hexPath(CX, CY, OUTER_R)}" fill="url(#rim)" stroke="${EDGE}" stroke-width="${EDGE_W}" stroke-linejoin="round" />
  <path d="${hexPath(CX, CY, OUTER_R - RIM_W)}" fill="${WHITE}" stroke="${EDGE}" stroke-width="${EDGE_W}" stroke-linejoin="round" />

  <g fill="none" stroke="${EDGE}" stroke-width="${COMB_W + EDGE_W * 2}" stroke-linejoin="round">
    ${cells.map((d) => `<path d="${d}" />`).join('\n    ')}
  </g>
  <g fill="none" stroke="${COMB}" stroke-width="${COMB_W}" stroke-linejoin="round">
    ${cells.map((d) => `<path d="${d}" />`).join('\n    ')}
  </g>

  <g fill="none" stroke="${EDGE}" stroke-width="${SPOKE_W + EDGE_W * 2}" stroke-linecap="round">
    ${rays.map((d) => `<path d="${d}" />`).join('\n    ')}
  </g>
  <g fill="none" stroke="${SPOKE}" stroke-width="${SPOKE_W}" stroke-linecap="round">
    ${rays.map((d) => `<path d="${d}" />`).join('\n    ')}
  </g>
</svg>`
}

// --- emit -----------------------------------------------------------------
mkdirSync(BUILD, { recursive: true })
const svgPath = join(BUILD, 'icon.svg')
writeFileSync(svgPath, buildSvg())
console.log('wrote build/icon.svg')

function have(bin) {
  try {
    execFileSync('command', ['-v', bin], { shell: true, stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!have('rsvg-convert')) {
  console.warn('rsvg-convert not found — wrote the SVG only. Install librsvg to rasterise.')
  process.exit(0)
}

const png = (size, out) =>
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), svgPath, '-o', out])

png(1024, join(BUILD, 'icon.png'))
console.log('wrote build/icon.png (1024)')

const iconsDir = join(BUILD, 'icons')
rmSync(iconsDir, { recursive: true, force: true })
mkdirSync(iconsDir, { recursive: true })
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) {
  png(size, join(iconsDir, `${size}x${size}.png`))
}
console.log('wrote build/icons/*.png')

// macOS .icns, via a temporary .iconset. iconutil ships with macOS only.
if (process.platform === 'darwin' && have('iconutil')) {
  const iconset = join(BUILD, 'icon.iconset')
  rmSync(iconset, { recursive: true, force: true })
  mkdirSync(iconset, { recursive: true })
  const faces = [
    [16, 'icon_16x16.png'], [32, 'icon_16x16@2x.png'],
    [32, 'icon_32x32.png'], [64, 'icon_32x32@2x.png'],
    [128, 'icon_128x128.png'], [256, 'icon_128x128@2x.png'],
    [256, 'icon_256x256.png'], [512, 'icon_256x256@2x.png'],
    [512, 'icon_512x512.png'], [1024, 'icon_512x512@2x.png'],
  ]
  for (const [size, name] of faces) png(size, join(iconset, name))
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(BUILD, 'icon.icns')])
  rmSync(iconset, { recursive: true, force: true })
  console.log('wrote build/icon.icns')
} else {
  console.log('skipped build/icon.icns (needs macOS iconutil)')
}

if (!existsSync(join(BUILD, 'icon.png'))) process.exitCode = 1

// The SVG builder behind `npm run diagrams`: boxes, panels, stores and arrows in one style that follows the reader's light or dark theme.
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const STYLE = `
  .bg { fill: #ffffff; }
  .t { fill: #1f2328; font: 600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .s { fill: #59636e; font: 400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .g { fill: #59636e; font: 600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; letter-spacing: .02em; }
  .l { fill: #59636e; font: 400 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  .box { fill: #ffffff; stroke: #d0d7de; stroke-width: 1; }
  .ui { fill: #ddf4ff; stroke: #54aeff; }
  .main { fill: #fff8c5; stroke: #d4a72c; }
  .work { fill: #dafbe1; stroke: #4ac26b; }
  .out { fill: #f6f8fa; stroke: #d0d7de; }
  .grp { stroke-width: 1; }
  .sub { fill: #ffffff; fill-opacity: .55; stroke-dasharray: 4 3; }
  .a { stroke: #6e7781; stroke-width: 1.5; fill: none; }
  .d { stroke-dasharray: 5 4; }
  .ah { fill: #6e7781; }
  .life { stroke: #d0d7de; stroke-width: 1; stroke-dasharray: 4 4; }
  .note { fill: #fff8c5; stroke: #d4a72c; }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #0d1117; }
    .t { fill: #e6edf3; }
    .s, .g, .l { fill: #9198a1; }
    .box { fill: #161b22; stroke: #3d444d; }
    .ui { fill: #0c2d6b; fill-opacity: .55; stroke: #1f6feb; }
    .main { fill: #3b2e00; fill-opacity: .7; stroke: #9e6a03; }
    .work { fill: #033a16; fill-opacity: .7; stroke: #238636; }
    .out { fill: #161b22; stroke: #3d444d; }
    .sub { fill: #0d1117; fill-opacity: .45; }
    .a { stroke: #8b949e; }
    .ah { fill: #8b949e; }
    .life { stroke: #3d444d; }
    .note { fill: #3b2e00; stroke: #9e6a03; }
  }`

export class Svg {
  constructor(w, h, title) { this.w = w; this.h = h; this.title = title; this.parts = [] }
  group(x, y, w, h, label, cls) {
    this.parts.push(`<rect class="grp ${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="12"/>`)
    if (label) this.parts.push(`<text class="g" x="${x + 14}" y="${y + 20}">${esc(label)}</text>`)
  }
  box(x, y, w, h, title, subs = [], cls = 'box') {
    this.parts.push(`<rect class="${cls}" x="${x}" y="${y}" width="${w}" height="${h}" rx="8"/>`)
    this.#lines(x + w / 2, y, h, title, subs)
  }
  store(x, y, w, h, title, subs = []) {
    const ry = 7
    this.parts.push(`<path class="box" d="M${x} ${y + ry} A${w / 2} ${ry} 0 0 1 ${x + w} ${y + ry} V${y + h - ry} A${w / 2} ${ry} 0 0 1 ${x} ${y + h - ry} Z"/>`)
    this.parts.push(`<path class="box" style="fill:none" d="M${x} ${y + ry} A${w / 2} ${ry} 0 0 0 ${x + w} ${y + ry}"/>`)
    this.#lines(x + w / 2, y + 5, h - 5, title, subs)
  }
  #lines(cx, y, h, title, subs) {
    const n = 1 + subs.length
    const total = 18 + (n - 1) * 16
    let ty = y + (h - total) / 2 + 14
    this.parts.push(`<text class="t" x="${cx}" y="${ty}" text-anchor="middle">${esc(title)}</text>`)
    for (const s of subs) { ty += 17; this.parts.push(`<text class="s" x="${cx}" y="${ty}" text-anchor="middle">${esc(s)}</text>`) }
  }
  text(x, y, s, anchor = 'start', cls = 'l') {
    this.parts.push(`<text class="${cls}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(s)}</text>`)
  }
  /** pts: [[x,y],...]; arrowhead at the end, and at the start when both. */
  arrow(pts, { dashed = false, both = false, head = true } = {}) {
    const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join(' ')
    this.parts.push(`<path class="a${dashed ? ' d' : ''}" d="${d}"/>`)
    if (head) this.#head(pts.at(-2), pts.at(-1))
    if (both) this.#head(pts[1], pts[0])
  }
  #head([x1, y1], [x2, y2]) {
    const a = Math.atan2(y2 - y1, x2 - x1), L = 9, W = 4.5
    const bx = x2 - L * Math.cos(a), by = y2 - L * Math.sin(a)
    const p = [[x2, y2], [bx + W * Math.sin(a), by - W * Math.cos(a)], [bx - W * Math.sin(a), by + W * Math.cos(a)]]
    this.parts.push(`<path class="ah" d="M${p.map((q) => q.map((v) => v.toFixed(1)).join(' ')).join(' L')} Z"/>`)
  }
  raw(s) { this.parts.push(s) }
  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${this.w} ${this.h}" width="${this.w}" height="${this.h}" role="img" aria-label="${esc(this.title)}">
<title>${esc(this.title)}</title>
<style>${STYLE}
</style>
<rect class="bg" x="0" y="0" width="${this.w}" height="${this.h}" rx="12"/>
${this.parts.join('\n')}
</svg>
`
  }
}

import type { BodyShape } from '@shared/pets/spec'

/**
 * Signed distance functions for the pets' bodies, in a box from −1 to 1 (y up). Negative inside.
 * Every body is a smooth union of soft primitives, which is what makes them read as stuffed toys
 * rather than geometry: no edge is sharper than a seam in felt.
 */
export type Sdf = (x: number, y: number, z: number) => number

function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k
  return Math.min(a, b) - h * h * k * 0.25
}

/** An ellipsoid's distance, approximately (good enough near its surface, which is all that is meshed). */
function ellipsoid(x: number, y: number, z: number, rx: number, ry: number, rz: number): number {
  const k0 = Math.hypot(x / rx, y / ry, z / rz)
  const k1 = Math.hypot(x / (rx * rx), y / (ry * ry), z / (rz * rz))
  return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1
}

function roundBox(x: number, y: number, z: number, bx: number, by: number, bz: number, r: number): number {
  const qx = Math.abs(x) - bx + r
  const qy = Math.abs(y) - by + r
  const qz = Math.abs(z) - bz + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - r
}

/** The bottom of every body sits at y = −0.62, its widest a little above. */
export const BODY_SDF: Record<BodyShape, Sdf> = {
  blob: (x, y, z) => {
    // A lumpy cushion: one wide puff, softened by smaller ones so it is not a perfect ball.
    let d = ellipsoid(x, y + 0.05, z, 0.62, 0.56, 0.5)
    d = smin(d, ellipsoid(x - 0.3, y + 0.22, z, 0.38, 0.36, 0.42), 0.25)
    d = smin(d, ellipsoid(x + 0.32, y + 0.2, z, 0.36, 0.38, 0.4), 0.25)
    d = smin(d, ellipsoid(x + 0.08, y - 0.3, z, 0.42, 0.3, 0.4), 0.3)
    return d
  },
  bean: (x, y, z) => ellipsoid(x, y + 0.02, z, 0.5, 0.62, 0.46),
  drop: (x, y, z) => {
    // A soft triangle: a wide bottom, rising into a rounded peak.
    let d = ellipsoid(x, y + 0.22, z, 0.6, 0.42, 0.48)
    d = smin(d, ellipsoid(x, y - 0.12, z, 0.38, 0.4, 0.36), 0.3)
    d = smin(d, ellipsoid(x, y - 0.4, z, 0.16, 0.2, 0.18), 0.3)
    return d
  },
  heart: (x, y, z) => {
    let d = ellipsoid(x - 0.27, y - 0.12, z, 0.36, 0.38, 0.4)
    d = smin(d, ellipsoid(x + 0.27, y - 0.12, z, 0.36, 0.38, 0.4), 0.12)
    d = smin(d, ellipsoid(x, y + 0.28, z, 0.36, 0.34, 0.36), 0.35)
    return d
  },
  star: (x, y, z) => {
    // Five plump points around a round middle, the bottom two a little splayed to stand on.
    let d = ellipsoid(x, y + 0.04, z, 0.34, 0.34, 0.36)
    for (let i = 0; i < 5; i++) {
      const t = Math.PI / 2 + (i * 2 * Math.PI) / 5
      const px = Math.cos(t) * 0.46
      const py = Math.sin(t) * 0.46 - 0.04
      d = smin(d, ellipsoid(x - px, y - py, z, 0.19, 0.19, 0.22), 0.16)
    }
    return d
  },
  ghost: (x, y, z) => {
    let d = ellipsoid(x, y - 0.08, z, 0.48, 0.52, 0.44)
    d = smin(d, ellipsoid(x, y + 0.36, z, 0.5, 0.26, 0.44), 0.2)
    // The scalloped hem: three little feet of fabric.
    for (const fx of [-0.3, 0, 0.3]) d = smin(d, ellipsoid(x - fx, y + 0.56, z, 0.16, 0.1, 0.16), 0.08)
    return d
  },
  puff: (x, y, z) => {
    // A cloud: a round middle with puffs around its top and sides, flat enough below to sit on.
    let d = ellipsoid(x, y + 0.08, z, 0.44, 0.4, 0.4)
    for (const [cx, cy, r] of [[-0.38, -0.16, 0.27], [0.38, -0.16, 0.27], [-0.22, 0.22, 0.26], [0.22, 0.22, 0.26], [0, 0.32, 0.25]] as const) {
      d = smin(d, ellipsoid(x - cx, y - cy, z, r, r, r * 1.1), 0.12)
    }
    return d
  },
  cube: (x, y, z) => roundBox(x, y + 0.02, z, 0.52, 0.58, 0.42, 0.24),
}

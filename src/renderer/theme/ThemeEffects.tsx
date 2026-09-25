import { useEffect, useRef } from 'react'
import type { EffectSpec } from '@shared/theme/spec'
import { EFFECTS } from '@shared/theme/effects'
import { THEME_CHANGE_EVENT } from './applyTheme'

const FPS = 30
const MAX_DPR = 1.5
/** A window left in the background this long stops animating until it is focused again. */
const BLUR_PAUSE_MS = 30_000

interface Props {
  effects: EffectSpec[]
  /** The Animated effects setting. Off (or the OS asking for reduced motion) draws a still frame. */
  animated: boolean
  /** The global intensity multiplier, 0–1. */
  intensity: number
}

/**
 * The theme's effects: one canvas behind the panels and one over them, both ignoring the pointer.
 *
 * Everything drawn comes from the catalogue in shared/theme/effects — this component only decides
 * *when* to draw: at most 30 fps, never while the window is hidden, not after it has been in the
 * background for 30 seconds, and just once (a still frame) when motion is off. With no effects it
 * renders nothing at all, so the original look costs nothing.
 */
export function ThemeEffects({ effects, animated, intensity }: Props): JSX.Element | null {
  const back = useRef<HTMLCanvasElement | null>(null)
  const front = useRef<HTMLCanvasElement | null>(null)
  const canvasEffects = effects.filter((e) => e.kind !== 'neon-glow')
  const hasBack = canvasEffects.some((e) => EFFECTS[e.kind as keyof typeof EFFECTS].layer === 'back')
  const hasFront = canvasEffects.some((e) => EFFECTS[e.kind as keyof typeof EFFECTS].layer === 'front')
  const signature = JSON.stringify(canvasEffects)

  useEffect(() => {
    if (canvasEffects.length === 0) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    let colors = new Map<string, string>()
    const readColors = (): void => {
      const css = getComputedStyle(document.documentElement)
      colors = new Map(canvasEffects.map((e) => {
        const token = e.color ?? 'accent'
        return [token, css.getPropertyValue(`--${token}`).trim() || '#ffffff']
      }))
    }
    readColors()

    const size = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
      for (const c of [back.current, front.current]) {
        if (c === null) continue
        c.width = Math.round(window.innerWidth * dpr)
        c.height = Math.round(window.innerHeight * dpr)
        c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    let frames = 0
    const drawAt = (t: number, still: boolean): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      for (const [canvas, layer] of [[back.current, 'back'], [front.current, 'front']] as const) {
        const ctx = canvas?.getContext('2d')
        if (canvas === null || ctx === null || ctx === undefined) continue
        ctx.clearRect(0, 0, w, h)
        for (const e of canvasEffects) {
          const effect = EFFECTS[e.kind as keyof typeof EFFECTS]
          if (effect.layer !== layer) continue
          effect.draw(ctx, { t, w, h, still }, {
            intensity: e.intensity * intensity, speed: e.speed, density: e.density,
            color: colors.get(e.color ?? 'accent') ?? '#ffffff',
          })
        }
        // Counted for the tests, which check that "motion off" really means no new frames.
        canvas.dataset.frames = String((frames += 1))
      }
    }

    let raf: number | null = null
    let last = 0
    let blurredAt: number | null = document.hasFocus() ? null : performance.now()
    const moving = (): boolean => animated && !reducedMotion.matches
    const tick = (now: number): void => {
      raf = null
      if (document.hidden) return
      if (blurredAt !== null && now - blurredAt > BLUR_PAUSE_MS) return
      if (now - last >= 1000 / FPS) { last = now; drawAt(now / 1000, false) }
      raf = requestAnimationFrame(tick)
    }
    const start = (): void => {
      size()
      if (raf !== null) cancelAnimationFrame(raf)
      raf = null
      if (moving()) raf = requestAnimationFrame(tick)
      else drawAt(0, true)
    }
    const onFocus = (): void => { blurredAt = null; if (raf === null && moving()) raf = requestAnimationFrame(tick) }
    const onBlur = (): void => { blurredAt = performance.now() }
    const onVisibility = (): void => { if (!document.hidden && raf === null && moving()) raf = requestAnimationFrame(tick) }
    const onTheme = (): void => { readColors(); if (!moving()) drawAt(0, true) }

    start()
    window.addEventListener('resize', start)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener(THEME_CHANGE_EVENT, onTheme)
    reducedMotion.addEventListener('change', start)
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      window.removeEventListener('resize', start)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
      reducedMotion.removeEventListener('change', start)
    }
    // `signature` stands in for the effects array, which is a new object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, animated, intensity])

  if (canvasEffects.length === 0) return null
  return (
    <>
      {hasBack && <canvas ref={back} className="theme-effects theme-effects-back" data-testid="theme-effects-back" aria-hidden="true" />}
      {hasFront && <canvas ref={front} className="theme-effects theme-effects-front" data-testid="theme-effects-front" aria-hidden="true" />}
    </>
  )
}

import { type JSX, useEffect, useRef } from 'react'
import type { EffectSpec } from '@shared/theme/spec'
import { EFFECTS } from '@shared/theme/effects'
import { parseColor, saturate, toHex8 } from '@shared/theme/color'
import { THEME_CHANGE_EVENT } from './applyTheme'

const FPS = 30
const MAX_DPR = 1.5
/**
 * Without GPU compositing (Chromium's own choice on some Linux drivers, VMs and remote desktops)
 * every animation frame is composited on the CPU, and an animated theme measurably slowed
 * hovering, dragging and typing (tests/e2e/bench/themePerf.spec.ts with APIARY_BENCH_GPU=off).
 * There the effects move at half the rate and draw at 1× resolution.
 */
const LOW_POWER_FPS = 15
const LOW_POWER_DPR = 1
/** A window left in the background this long stops animating until it is focused again. */
const BLUR_PAUSE_MS = 30_000

interface Props {
  effects: EffectSpec[]
  /** Off (or reduced motion in effect, `state/motion.ts`) draws a still frame. */
  animated: boolean
  /** 0–1. */
  intensity: number
  /**
   * A glass theme's blur and saturation. Done here, not with `backdrop-filter` on the panels: a
   * live backdrop filter per pane re-ran every frame and, without GPU compositing, made hovering
   * lag by most of a second (tests/e2e/bench/themePerf.spec.ts). The back canvas is drawn at a
   * fraction of the window's resolution and scaled up, which is the blur.
   */
  glass?: { blur: number; saturation: number } | null
  /** True when Chromium composites in software (see LOW_POWER_FPS). */
  lowPower?: boolean
}

/**
 * One canvas behind the panels and one over them; the drawing is `shared/theme/effects`, this
 * decides *when*: at most 30 fps, never while the window is hidden, not after 30 s in the
 * background, one still frame when motion is off, and nothing at all with no effects.
 */
export function ThemeEffects({ effects, animated, intensity, glass = null, lowPower = false }: Props): JSX.Element | null {
  const back = useRef<HTMLCanvasElement | null>(null)
  const front = useRef<HTMLCanvasElement | null>(null)
  const canvasEffects = effects.filter((e) => e.kind !== 'neon-glow')
  const hasBack = canvasEffects.some((e) => EFFECTS[e.kind as keyof typeof EFFECTS].layer === 'back')
  const hasFront = canvasEffects.some((e) => EFFECTS[e.kind as keyof typeof EFFECTS].layer === 'front')
  const signature = JSON.stringify(canvasEffects)

  useEffect(() => {
    if (canvasEffects.length === 0) return
    let colors = new Map<string, string>()
    const readColors = (): void => {
      const css = getComputedStyle(document.documentElement)
      colors = new Map(canvasEffects.map((e) => {
        const token = e.color ?? 'accent'
        const value = css.getPropertyValue(`--${token}`).trim() || '#ffffff'
        const parsed = glass === null ? null : parseColor(value)
        return [token, parsed === null || glass === null ? value : toHex8(saturate(parsed, glass.saturation))]
      }))
    }
    readColors()

    const size = (): void => {
      const dpr = Math.min(window.devicePixelRatio || 1, lowPower ? LOW_POWER_DPR : MAX_DPR)
      // Behind glass: about one canvas pixel per third of the blur radius; the browser's smoothing does the blurring.
      const backScale = glass === null ? dpr : Math.min(dpr, 3 / Math.max(3, glass.blur))
      for (const [c, scale] of [[back.current, backScale], [front.current, dpr]] as const) {
        if (c === null) continue
        c.width = Math.max(1, Math.round(window.innerWidth * scale))
        c.height = Math.max(1, Math.round(window.innerHeight * scale))
        c.getContext('2d')?.setTransform(scale, 0, 0, scale, 0, 0)
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
    const moving = (): boolean => animated
    const tick = (now: number): void => {
      raf = null
      if (document.hidden) return
      if (blurredAt !== null && now - blurredAt > BLUR_PAUSE_MS) return
      // Held while a divider is dragged: a new effects frame on top of the re-layout made dragging a
      // frame or three late on animated themes.
      const dragging = document.body.classList.contains('resizing-active')
      if (!dragging && now - last >= 1000 / (lowPower ? LOW_POWER_FPS : FPS)) { last = now; drawAt(now / 1000, false) }
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
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
      window.removeEventListener('resize', start)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener(THEME_CHANGE_EVENT, onTheme)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands in for the effects array, a new object every render
  }, [signature, animated, intensity, glass?.blur, glass?.saturation, lowPower])

  if (canvasEffects.length === 0) return null
  return (
    <>
      {hasBack && <canvas ref={back} className="theme-effects theme-effects-back" data-testid="theme-effects-back" aria-hidden="true" />}
      {hasFront && <canvas ref={front} className="theme-effects theme-effects-front" data-testid="theme-effects-front" aria-hidden="true" />}
    </>
  )
}

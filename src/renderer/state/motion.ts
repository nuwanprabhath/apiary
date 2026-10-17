import { useEffect } from 'react'
import type { MotionSetting } from '@shared/settings/schema'
import { createLocalStore } from './createLocalStore'
import { useAppSettings } from './settingsStore'
import { readGpuCompositing } from './theme'

/** Which motion the chrome shows: `reduced` has no infinite animation (`:root[data-motion="reduced"]`). */
export type Motion = 'full' | 'reduced'

const QUERY = '(prefers-reduced-motion: reduce)'

/** The setting, the system preference and the GPU probe, reduced to the motion in effect. */
function resolveMotion(setting: MotionSetting, systemReduced: boolean, gpuCompositing: boolean): Motion {
  if (setting !== 'auto') return setting
  return systemReduced || !gpuCompositing ? 'reduced' : 'full'
}

const systemReduced = createLocalStore<boolean>(false)
const gpuStore = createLocalStore<boolean>(true)

/** Whether the GPU composites this window; true until main answers or when the probe fails. */
export const useGpuCompositing = (): boolean => gpuStore.useStore()

/** The bridge the probe was read through, so a test that swaps `window.apiary` probes again. */
let probedFor: unknown = null
function wire(): () => void {
  if (probedFor !== window.apiary) {
    probedFor = window.apiary
    gpuStore.set(true)
    void readGpuCompositing().then((on) => { if (on !== null) gpuStore.set(on) })
  }
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(QUERY)
  const read = (): void => { systemReduced.set(query.matches) }
  read()
  query.addEventListener('change', read)
  return () => { query.removeEventListener('change', read) }
}

export function useMotion(): Motion {
  useEffect(wire, [])
  const { motion } = useAppSettings()
  return resolveMotion(motion, systemReduced.useStore(), gpuStore.useStore())
}

/** Sets `<html data-motion>` from the motion in effect; mounted once, by the theme effects layer. */
export function useMotionAttribute(): Motion {
  const motion = useMotion()
  useEffect(() => { document.documentElement.dataset.motion = motion }, [motion])
  return motion
}

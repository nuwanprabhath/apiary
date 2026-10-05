import { useEffect, useState } from 'react'
import type { PetSpec } from '@shared/pets/spec'
import type { PetImages, PropImages } from './render'
import type { FromRenderer, ToRenderer } from './petRender.worker'

/**
 * Bump when the renderer's output changes (a part redrawn, the lighting), so saved renders from
 * an older version are not shown.
 */
const RENDER_VERSION = 3

/** What a pet looks like, without what it says: two pets that look alike share their renders. */
export function lookKey(spec: PetSpec): string {
  const { body, eyes, cheeks, arms, legs, accessories } = spec
  return `v${String(RENDER_VERSION)}:${JSON.stringify({ body, eyes, cheeks, arms, legs, accessories })}`
}

// -- saved renders: a pet takes the better part of a second to render, so it is done once and
// kept in IndexedDB, and comes back instantly on the next launch. Every access is allowed to
// fail (a private profile, cleared storage) — then it is simply rendered again.

const DB = 'apiary-pets'
const STORE = 'renders'
/** Renders kept at most; the oldest go first. Each is under a megabyte. */
const KEEP = 24

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1)
      req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
      req.onsuccess = () => { resolve(req.result) }
      req.onerror = () => { resolve(null) }
    } catch {
      resolve(null)
    }
  })
}

let db: Promise<IDBDatabase | null> | null = null
const database = (): Promise<IDBDatabase | null> => (db ??= openDb())

async function loadSaved<T>(key: string): Promise<T | null> {
  const d = await database()
  if (d === null) return null
  return new Promise((resolve) => {
    try {
      const req = d.transaction(STORE).objectStore(STORE).get(key)
      req.onsuccess = () => { resolve((req.result as { images?: T } | undefined)?.images ?? null) }
      req.onerror = () => { resolve(null) }
    } catch {
      resolve(null)
    }
  })
}

async function save(key: string, images: PetImages | PropImages): Promise<void> {
  const d = await database()
  if (d === null) return
  try {
    const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
    store.put({ images, at: Date.now() }, key)
    // Then trim to the newest few: walk them all once, delete the oldest.
    const rows: { key: IDBValidKey; at: number }[] = []
    const cursor = store.openCursor()
    cursor.onsuccess = () => {
      const c = cursor.result
      if (c !== null) {
        rows.push({ key: c.key, at: (c.value as { at: number }).at })
        c.continue()
        return
      }
      rows.sort((a, b) => b.at - a.at)
      for (const r of rows.slice(KEEP)) store.delete(r.key)
    }
  } catch { /* only a cache */ }
}

// -- the worker

let worker: Worker | null = null
let broken = false
let next = 1
const waiting = new Map<number, (r: FromRenderer) => void>()
const cache = new Map<string, Promise<PetImages | null>>()

function renderer(): Worker | null {
  if (broken) return null
  if (worker !== null) return worker
  try {
    worker = new Worker(new URL('./petRender.worker.ts', import.meta.url), { type: 'module', name: 'pet-render' })
    worker.addEventListener('message', (e: MessageEvent<FromRenderer>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    })
    worker.addEventListener('error', () => {
      broken = true
      for (const [id, done] of waiting) done({ id, error: 'The renderer stopped.' })
      waiting.clear()
    })
    return worker
  } catch {
    broken = true
    return null
  }
}

function ask<T>(msg: Omit<ToRenderer, 'id'>, pick: (r: FromRenderer) => T | null): Promise<T | null> {
  const w = renderer()
  if (w === null) return Promise.resolve(null)
  const id = next++
  return new Promise((resolve) => {
    waiting.set(id, (r) => { resolve(pick(r)) })
    w.postMessage({ id, ...msg })
  })
}

function renderInWorker(spec: PetSpec): Promise<PetImages | null> {
  return ask({ spec }, (r) => ('images' in r ? r.images : null))
}

let props: Promise<PropImages | null> | null = null

/** The props and scenery, rendered once for every pet (and kept across launches). */
export function renderProps(): Promise<PropImages | null> {
  if ((globalThis as Record<string, unknown>)[FLAT_FLAG] === true) return Promise.resolve(null)
  const key = `v${String(RENDER_VERSION)}:props`
  props ??= loadSaved<PropImages>(key).then(async (saved) => {
    if (saved !== null) return saved
    const images = await ask({ props: true }, (r) => ('props' in r ? r.props : null))
    if (images !== null) void save(key, images)
    return images
  })
  return props
}

/** The props once rendered; null meanwhile, or where 3D is unavailable. */
export function useProps(): PropImages | null {
  const [state, setState] = useState<PropImages | null>(null)
  useEffect(() => {
    let live = true
    void renderProps().then((p) => { if (live) setState(p) })
    return () => { live = false }
  }, [])
  return state
}

/**
 * Test seam: component tests draw pets flat. Their WebGL is software rendering, slow enough to
 * starve the tests running beside it; the tests about the 3D renderer switch it back on. On
 * `globalThis` because a test module and the app may be loaded as separate module instances.
 */
const FLAT_FLAG = '__apiaryPetsFlat'
export function drawPetsFlat(on: boolean): void { (globalThis as Record<string, unknown>)[FLAT_FLAG] = on }

/** Renders a pet once per look (saved across launches); null when 3D is not available here. */
export function renderPet(spec: PetSpec): Promise<PetImages | null> {
  if ((globalThis as Record<string, unknown>)[FLAT_FLAG] === true) return Promise.resolve(null)
  const key = lookKey(spec)
  const known = cache.get(key)
  if (known !== undefined) return known
  const result = loadSaved<PetImages>(key).then(async (saved) => {
    if (saved !== null) return saved
    const images = await renderInWorker(spec)
    if (images !== null) void save(key, images)
    return images
  })
  cache.set(key, result)
  return result
}

export type PetLook = { state: 'pending' } | { state: 'ready'; images: PetImages } | { state: 'flat' }

/** The pet's rendered layers once ready; `flat` where 3D is unavailable, `pending` meanwhile. */
export function usePetImages(spec: PetSpec): PetLook {
  const key = lookKey(spec)
  const [state, setState] = useState<{ key: string; look: PetLook } | null>(null)
  useEffect(() => {
    let live = true
    void renderPet(spec).then((images) => {
      if (live) setState({ key, look: images !== null ? { state: 'ready', images } : { state: 'flat' } })
    })
    return () => { live = false }
    // The look, not the spec object: lines changing must not re-render the fur.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on `key` on purpose
  }, [key])
  return state?.key === key ? state.look : { state: 'pending' }
}

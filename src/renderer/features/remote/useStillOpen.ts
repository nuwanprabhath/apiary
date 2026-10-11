import { useEffect, useRef, type RefObject } from 'react'

/**
 * Whether the component is still mounted, for a callback that outlives it: Escape closes the connect
 * dialog while a connect runs, and the connect finishes later. Read `.current` when the callback runs.
 */
export function useStillOpen(): RefObject<boolean> {
  const open = useRef(true)
  useEffect(() => {
    open.current = true
    return () => { open.current = false }
  }, [])
  return open
}

import { useEffect, useState } from 'react'
import { isVsCodeAvailable } from './sessions'

/**
 * Whether VS Code is on this machine. False until main has answered, and when it cannot say. Asked
 * once per mount, not cached across them: main's answer is one property read, and a module-level
 * copy would outlive a window's bridge (and leak between component tests).
 */
export function useVsCodeAvailable(): boolean {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let live = true
    void isVsCodeAvailable().then((v) => { if (live) setAvailable(v) })
    return () => { live = false }
  }, [])
  return available
}

import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from '../../ui/icons'
import { openResidentPopup } from '../../state/residentPopup'
import { useFirstEnabledResident } from '../../state/residentSummon'

const isMac = navigator.userAgent.includes('Mac')
const ASK_KEY = isMac ? '⌘↵' : 'Ctrl+↵'

/** Wait after the last keystroke before the rest of the app hears about it. */
const DEBOUNCE_MS = 150

interface Props {
  /** Called with the settled query — never per keystroke. Must be referentially stable. */
  onChange: (query: string) => void
  /** The query the results on screen were built from; when it differs from the text, the field shows it is catching up. */
  resultsFor: string
}

/**
 * The search box, and the only component that re-renders while someone is typing.
 *
 * The text lives here, not in `Sidebar`: held one level up, every keystroke re-rendered hundreds of
 * rows and the box lagged behind the typing. The rest of the app only learns the query once it
 * settles.
 */
export function SearchField({ onChange, resultsFor }: Props): JSX.Element {
  const [text, setText] = useState('')
  const resident = useFirstEnabledResident()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => { onChange(text) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [text, onChange])

  const clear = useCallback(() => {
    setText('')
    // Published straight away: old results lingering after a deliberate clear read as a stutter.
    onChange('')
    inputRef.current?.focus()
  }, [onChange])

  const catchingUp = text.trim() !== resultsFor.trim()


  return (
    <div className="search-field">
      <input
        ref={inputRef}
        className="search"
        data-testid="search-input"
        placeholder="Search sessions"
        value={text}
        title={resident === null ? undefined : `${ASK_KEY} asks ${resident.name}`}
        onChange={(e) => { setText(e.target.value) }}
        onKeyDown={(e) => {
          const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
          if (e.key !== 'Enter' || !mod || resident === null || text.trim() === '') return
          e.preventDefault()
          openResidentPopup(resident.id, text)
        }}
      />
      {catchingUp && (
        <span
          className="search-spinner"
          data-testid="search-spinner"
          role="status"
          aria-label="Searching"
        />
      )}
      {text !== '' && (
        <button
          className="search-clear"
          data-testid="search-clear"
          title="Clear search"
          aria-label="Clear search"
          onClick={clear}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

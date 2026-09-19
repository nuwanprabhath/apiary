import { useCallback, useEffect, useRef, useState } from 'react'
import { CloseIcon } from './icons'

/** How long the box waits, after the last keystroke, before the rest of the app hears about it. */
const DEBOUNCE_MS = 150

interface Props {
  /** Called with the settled query — never per keystroke. Must be referentially stable. */
  onChange: (query: string) => void
  /**
   * The query the results currently on screen were built from. When it differs from what has been
   * typed, the field shows that it is still catching up.
   */
  resultsFor: string
}

/**
 * The search box, and the only component that re-renders while someone is typing.
 *
 * The text lives here rather than in `Sidebar` on purpose. Held one level up, every keystroke
 * re-rendered the whole sidebar — and with a few hundred sessions that is hundreds of rows of
 * React work between pressing a key and seeing the letter. The symptom is a box that stops at "te"
 * and catches up with "test" a second later, which is the worst kind of slow: the machine appears
 * to have lost your input.
 *
 * So the typed text stays local, and the rest of the app only learns the query once it settles.
 * Filtering hundreds of sessions is allowed to take a moment; typing is not.
 */
export function SearchField({ onChange, resultsFor }: Props): JSX.Element {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => { onChange(text) }, DEBOUNCE_MS)
    return () => { clearTimeout(timer) }
  }, [text, onChange])

  const clear = useCallback(() => {
    setText('')
    // Published straight away rather than waiting out the debounce: clearing is a deliberate act
    // with an obvious expected result, and 150ms of the old results after it reads as a stutter.
    onChange('')
    inputRef.current?.focus()
  }, [onChange])

  // Only ever true when there is something typed that the results do not yet reflect — so it
  // appears while a large library is being filtered and never merely because the box is empty.
  const catchingUp = text.trim() !== resultsFor.trim()


  return (
    <div className="search-field">
      <input
        ref={inputRef}
        className="search"
        data-testid="search-input"
        placeholder="Search sessions"
        value={text}
        onChange={(e) => { setText(e.target.value) }}
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

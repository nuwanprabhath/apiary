import { type JSX, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PetRecord } from '@shared/pets/state'
import type { ChatTurn } from '@shared/pets/prompt'
import { Popover } from '../../ui/Popover'
import { useEscape } from '../../ui/useEscape'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'
import { CloseIcon } from '../../ui/icons'
import { describeError } from '../../ui/errors'
import { chatWithPet } from '../../state/petsStore'

const WIDTH = 280

interface Props {
  pet: PetRecord
  /** Where the pet is on screen: the popover opens beside it. */
  anchor: { x: number; y: number }
  /** What was said before, kept by the layer so closing and reopening does not lose it. */
  history: ChatTurn[]
  onSaid: (turns: ChatTurn[]) => void
  onClose: () => void
}

/**
 * A small chat with a pet, opened by clicking it. Each message is one call to the pet's own model
 * (main/pets/petService.ts), which remembers the last few exchanges; the answer is plain text,
 * drawn as text.
 */
export function PetChat({ pet, anchor, history, onSaid, onClose }: Props): JSX.Element {
  const [text, setText] = useState('')
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const logRef = useRef<HTMLDivElement | null>(null)
  useEscape(onClose)

  // A press on a pet is not outside: the pet handles it itself (it toggles this chat).
  useOutsideDismiss(onClose, { inside: [rootRef], insideSelector: '.pet' })

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [history, thinking])

  const send = async (): Promise<void> => {
    const said = text.trim()
    if (said === '' || thinking) return
    setText('')
    setError(null)
    setThinking(true)
    const mine: ChatTurn = { from: 'you', text: said }
    onSaid([mine])
    try {
      const reply = await chatWithPet(pet.id, said)
      onSaid([{ from: 'pet', text: reply }])
    } catch (e) {
      setError(describeError(e).message)
    } finally {
      setThinking(false)
    }
  }

  const left = Math.min(Math.max(8, anchor.x - WIDTH / 2), window.innerWidth - WIDTH - 8)
  const bottom = Math.max(8, window.innerHeight - anchor.y + pet.size + 10)
  return createPortal(
    <Popover ref={rootRef} className="pet-chat" testId="pet-chat" label={`Chat with ${pet.spec.name}`} style={{ left, bottom }}>
      <div className="pet-chat-head">
        <span>{pet.spec.name}</span>
        <button className="icon-button" aria-label="Close" title="Close" onClick={onClose}><CloseIcon /></button>
      </div>
      <div ref={logRef} className="pet-chat-log" data-testid="pet-chat-log">
        {history.length === 0 && <div className="pet-chat-thinking">{pet.spec.tagline !== '' ? pet.spec.tagline : `Say hi to ${pet.spec.name}.`}</div>}
        {/* The log only ever grows at its end, so a turn's position is its identity. */}
        {/* eslint-disable-next-line @eslint-react/no-array-index-key -- append-only, see above */}
        {history.map((t, i) => <div key={i} className="pet-chat-line" data-from={t.from} data-testid="pet-chat-line">{t.text}</div>)}
        {thinking && <div className="pet-chat-thinking" data-testid="pet-chat-thinking">{pet.spec.name} is thinking…</div>}
        {error !== null && <div className="pet-chat-error" data-testid="pet-chat-error">{error}</div>}
      </div>
      <input
        className="search"
        data-testid="pet-chat-input"
        // A chat opened on purpose: the box is where the next keystroke should go.
        autoFocus
        placeholder={`Say something to ${pet.spec.name}…`}
        value={text}
        maxLength={500}
        onChange={(e) => { setText(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void send() } }}
      />
    </Popover>,
    document.body,
  )
}

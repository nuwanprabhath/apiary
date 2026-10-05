import { type JSX, useState } from 'react'
import { MAX_ACTIVE_PETS, PET_MODELS, type PetModel, type PetRecord } from '@shared/pets/state'
import { PetSprite } from '../../pets/PetSprite'
import { usePets } from '../../pets/usePets'
import { describeError } from '../../../ui/errors'
import { TrashIcon } from '../../../ui/icons'

const MODEL_LABELS: Record<PetModel, string> = {
  haiku: 'Haiku (fastest, default)',
  sonnet: 'Sonnet',
  opus: 'Opus',
}

/**
 * Settings → Pets. Like Themes, everything here takes effect at once (main's `pets.json`), not on
 * the dialog's Save: a pet you hatch should walk out while you watch.
 */
export function PetsSection(): JSX.Element {
  const state = usePets()
  const [description, setDescription] = useState('')
  const [model, setModel] = useState<PetModel>('haiku')
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const run = (p: Promise<unknown>): void => {
    setError(null)
    p.catch((e: unknown) => {
      const message = describeError(e).message
      if (message !== 'Cancelled.') setError(message)
    })
  }

  if (state === null) return <p className="settings-help">Loading…</p>
  const busy = state.generating
  const outCount = state.pets.filter((p) => p.active).length
  const hatch = (text: string | null): void => {
    run(window.apiary.petGenerate(text, model).then(() => { setDescription('') }))
  }

  return (
    <div className="pets-section" data-testid="pets-section">
      <label className="settings-row">
        <input
          type="checkbox"
          data-testid="setting-pets-enabled"
          checked={state.enabled}
          disabled={busy && !state.enabled}
          onChange={(e) => { run(window.apiary.petsSetEnabled(e.target.checked)) }}
        />
        <span>
          <strong>Show pets</strong>
          <span className="settings-help">
            Little characters that live on the status bar and up the sidebar&rsquo;s rail when it is
            collapsed. They wander, nap, read, and cheer Claude on. Drag one to move it, click it to
            chat, right-click for more. Their lines and chat come from the model you pick for each,
            about once an hour plus whenever you talk to one.
          </span>
        </span>
      </label>

      {state.enabled && busy && state.pets.length === 0 && (
        <p className="theme-busy" data-testid="pets-hatching"><span className="spinner-dot" /> Hatching your first pet…</p>
      )}

      {state.enabled && (
        <>
          {state.pets.length > 0 && (
            <div className="pet-grid" data-testid="pet-grid">
              {state.pets.map((pet) => (
                <PetCard
                  key={pet.id}
                  pet={pet}
                  canComeOut={pet.active || outCount < MAX_ACTIVE_PETS}
                  confirming={confirmDelete === pet.id}
                  onConfirm={(on) => { setConfirmDelete(on ? pet.id : null) }}
                  run={run}
                />
              ))}
            </div>
          )}

          <div className="theme-describe">
            <label className="theme-describe-label" htmlFor="pet-describe">
              <strong>Hatch a new pet</strong>
              <span className="settings-help">
                Describe how it looks and what it is like — &ldquo;a sleepy green frog in a tiny crown who
                loves tests&rdquo; — or let Claude surprise you.
              </span>
            </label>
            <textarea
              id="pet-describe"
              className="theme-describe-input"
              data-testid="pet-describe"
              rows={2}
              maxLength={1000}
              value={description}
              disabled={busy}
              placeholder="A cheerful orange blob with round glasses"
              onChange={(e) => { setDescription(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && description.trim() !== '' && !busy) { e.preventDefault(); hatch(description) }
              }}
            />
            <div className="theme-actions">
              {busy ? (
                <>
                  <span className="theme-busy" data-testid="pet-generating"><span className="spinner-dot" /> Claude is designing your pet…</span>
                  <button className="btn small" data-testid="pet-generate-cancel" onClick={() => { window.apiary.petGenerateCancel() }}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="btn primary small" data-testid="pet-generate" disabled={description.trim() === ''} onClick={() => { hatch(description) }}>Hatch</button>
                  <button className="btn small" data-testid="pet-surprise" onClick={() => { hatch(null) }}>Surprise me</button>
                  <button className="btn small" data-testid="pet-import" onClick={() => { run(window.apiary.petImport()) }}>Import…</button>
                </>
              )}
              <select
                className="theme-model"
                data-testid="pet-new-model"
                aria-label="Model for the new pet"
                value={model}
                disabled={busy}
                onChange={(e) => { setModel(e.target.value as PetModel) }}
              >
                {PET_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
              </select>
            </div>
          </div>
        </>
      )}

      {error !== null && <p className="theme-error" data-testid="pets-error">{error}</p>}
    </div>
  )
}

function PetCard({ pet, canComeOut, confirming, onConfirm, run }: {
  pet: PetRecord
  canComeOut: boolean
  confirming: boolean
  onConfirm: (on: boolean) => void
  run: (p: Promise<unknown>) => void
}): JSX.Element {
  const [name, setName] = useState(pet.spec.name)
  return (
    <div className="pet-card" data-testid="pet-card" data-pet-id={pet.id} data-active={pet.active}>
      <div className="pet-card-stage">
        <PetSprite spec={pet.spec} size={56} activity="idle" face="happy" facing="right" />
      </div>
      <input
        className="search pet-card-name"
        data-testid="pet-card-name"
        aria-label="Name"
        value={name}
        maxLength={24}
        onChange={(e) => { setName(e.target.value) }}
        onBlur={() => { if (name.trim() !== '' && name !== pet.spec.name) run(window.apiary.petUpdate(pet.id, { name })) }}
      />
      {pet.spec.tagline !== '' && <span className="settings-help pet-card-tagline">{pet.spec.tagline}</span>}
      <label className="pet-card-row" title={canComeOut ? undefined : `Up to ${String(MAX_ACTIVE_PETS)} pets can be out at once. Put one away first.`}>
        <input
          type="checkbox"
          data-testid="pet-card-out"
          checked={pet.active}
          disabled={!canComeOut}
          onChange={(e) => { run(window.apiary.petUpdate(pet.id, { active: e.target.checked })) }}
        />
        <span>Out</span>
      </label>
      <select
        className="theme-model"
        data-testid="pet-card-model"
        aria-label={`Model for ${pet.spec.name}`}
        value={pet.model}
        onChange={(e) => { run(window.apiary.petUpdate(pet.id, { model: e.target.value as PetModel })) }}
      >
        {PET_MODELS.map((m) => <option key={m} value={m}>{MODEL_LABELS[m]}</option>)}
      </select>
      <div className="pet-card-actions">
        <button className="btn small" data-testid="pet-card-export" onClick={() => { run(window.apiary.petExport(pet.id)) }}>Export…</button>
        {confirming ? (
          <>
            <button className="btn small danger" data-testid="pet-card-delete-confirm" onClick={() => { onConfirm(false); run(window.apiary.petDelete(pet.id)) }}>Delete</button>
            <button className="btn small" onClick={() => { onConfirm(false) }}>Keep</button>
          </>
        ) : (
          <button className="icon-button" data-testid="pet-card-delete" aria-label={`Delete ${pet.spec.name}`} title={`Delete ${pet.spec.name}`} onClick={() => { onConfirm(true) }}>
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  )
}

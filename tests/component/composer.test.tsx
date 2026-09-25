import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'
import { message } from './fakeApiary'

/** A 1x1 PNG, small enough to paste inline and still be a real image on disk. */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

/** Pastes an image into the composer the way a real paste arrives: as a file on the event. */
async function pasteImage(base64 = TINY_PNG): Promise<void> {
  page.getByTestId('composer-input').element().dispatchEvent(
    (() => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
      const file = new File([bytes], 'pasted.png', { type: 'image/png' })
      const dt = new DataTransfer()
      dt.items.add(file)
      return new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })
    })(),
  )
}

describe('composer images', () => {
  it('a pasted image becomes a thumbnail you can enlarge, and can be removed again', async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('composer-attachments')).not.toBeInTheDocument()

    await pasteImage()
    // Waited for directly: the paste handler updates state asynchronously (it reads the file via
    // `saveImage`), and `expect.element`'s first (failing) poll on a not-yet-existing element trips
    // a pretty-format recursion bug in this environment.
    await until(() => document.querySelector('[data-testid="composer-attachment"]') !== null)
    await expect.element(page.getByTestId('composer-attachment')).toBeVisible()
    expect(page.getByTestId('composer-attachment').elements()).toHaveLength(1)

    // Click the preview to see it full size — the thing the terminal could never do.
    await userEvent.click(page.getByTestId('composer-attachment-preview'))
    await expect.element(page.getByTestId('image-lightbox')).toBeVisible()
    await expect.element(page.getByTestId('image-lightbox-image')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('image-lightbox')).not.toBeInTheDocument()

    await userEvent.click(page.getByTestId('composer-attachment-remove'))
    await expect.element(page.getByTestId('composer-attachment')).not.toBeInTheDocument()
  })

  it('images already in a session render as thumbnails in the transcript', async () => {
    // Blocks the reader used to drop entirely, so a conversation that included a screenshot showed
    // a gap where the screenshot had been.
    await renderApp({
      sessions: [{
        sessionId: '99999999-9999-9999-9999-999999999999',
        title: 'Has an image in it',
        projectPath: '/fixture/work-a',
        messages: [
          {
            ...message('with-image', 'user', 'here is a screenshot'),
            blocks: [
              { type: 'text', text: 'here is a screenshot' },
              { type: 'image', dataUrl: `data:image/png;base64,${TINY_PNG}` },
            ],
          },
        ],
      }],
    })

    await userEvent.click(sidebarSession('Has an image in it'))
    await until(() => document.querySelector('[data-testid="image-thumb"]') !== null)
    const thumb = page.getByTestId('transcript').getByTestId('image-thumb')
    await expect.element(thumb).toBeVisible()
    expect(thumb.elements()).toHaveLength(1)

    await userEvent.click(thumb)
    await expect.element(page.getByTestId('image-lightbox-image')).toBeVisible()
  })
})

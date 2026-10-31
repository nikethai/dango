/**
 * @vitest-environment jsdom
 */

import NiceModal from '@ebay/nice-modal-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import PublishWebpageConfirm from './PublishWebpageConfirm'

const ID = 'publish-webpage-confirm'

beforeEach(() => {
  NiceModal.register(ID, PublishWebpageConfirm)
  render(
    <NiceModal.Provider>
      <div />
    </NiceModal.Provider>
  )
})
afterEach(cleanup)

function open() {
  let result: Promise<unknown> = Promise.resolve()
  act(() => {
    result = NiceModal.show(ID)
  })
  return result
}

describe('PublishWebpageConfirm', () => {
  it('says where the page goes and that the link is public', async () => {
    void open()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toContain('EdgeOne')
    expect(dialog.textContent).toContain('Anyone with the link')
  })

  it('Cancel resolves false and closes', async () => {
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBe(false)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('Publish resolves true', async () => {
    const result = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Publish' }))
    await expect(result).resolves.toBe(true)
  })
})

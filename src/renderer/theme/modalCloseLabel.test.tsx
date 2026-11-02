// @vitest-environment jsdom
import { MantineProvider, Modal } from '@mantine/core'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from './mantineTheme'

beforeEach(() => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: false,
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Modal close button', () => {
  it('is named by the label the theme is given', async () => {
    render(
      <MantineProvider theme={createDangoMantineTheme(1, 'Schließen')}>
        <Modal opened onClose={() => {}} title="Add provider">
          <p>Body</p>
        </Modal>
      </MantineProvider>
    )
    expect(await screen.findByRole('button', { name: 'Schließen' })).toBeTruthy()
  })
})

/**
 * @vitest-environment jsdom
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import NiceModal from '@ebay/nice-modal-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/writing/runtime', () => ({
  requestWritingRewrite: vi.fn(async (request: unknown) => ({ request, text: 'Hello there' })),
}))

import RewriteSheet from './RewriteSheet'

const REWRITE_ID = 'rewrite'

beforeEach(() => {
  NiceModal.register(REWRITE_ID, RewriteSheet)
})
afterEach(cleanup)

describe('RewriteSheet', () => {
  it('shows the options, and Use this hands the result back and closes', async () => {
    const onUse = vi.fn()
    render(
      <NiceModal.Provider>
        <div />
      </NiceModal.Provider>
    )
    act(() => {
      void NiceModal.show(REWRITE_ID, {
        text: 'hi',
        option: null,
        onUse,
        model: { provider: 'gemini', modelId: 'test-text' },
      })
    })
    for (const label of ['Clearer', 'Friendlier', 'Shorter', 'Formal', 'Translate']) {
      expect(await screen.findByRole('button', { name: label })).toBeTruthy()
    }
    fireEvent.click(screen.getByRole('button', { name: 'Shorter' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Use this' }))
    expect(onUse).toHaveBeenCalledWith('Hello there')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(tsx?|json)$/.test(name)) out.push(full)
  }
  return out
}

describe('Writing assistant removal', () => {
  it('ComposerToolsMenu has no Improve writing item', () => {
    const src = readFileSync(resolve(__dirname, '../components/InputBox/ComposerToolsMenu.tsx'), 'utf8')
    expect(src).not.toContain('Improve writing')
  })

  it("no file under src/renderer registers 'writing-assistant'", () => {
    const self = resolve(__filename)
    const hits = walk(resolve(__dirname, '..')).filter(
      (f) => resolve(f) !== self && readFileSync(f, 'utf8').includes("'writing-assistant'")
    )
    expect(hits).toEqual([])
  })
})

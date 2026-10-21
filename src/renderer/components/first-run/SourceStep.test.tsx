// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { SourceDraft } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/components/brand/Mascot', () => ({ Mascot: () => <svg /> }))

const h = vi.hoisted(() => ({
  pickSource: vi.fn(),
  connectSource: vi.fn(),
  discardSourceDraft: vi.fn(async () => {}),
  setFirstRun: vi.fn(),
  openConfiguration: vi.fn(async () => {}),
  addScope: vi.fn(),
}))

vi.mock('@/components/sources/SourceKindPicker', () => ({
  SourceKindPicker: (p: { onPick(kind: string, choice?: unknown): void; onMcp(): void }) => (
    <div data-testid="kind-picker">
      <button type="button" onClick={() => p.onPick('folder')}>
        pick folder
      </button>
      <button type="button" onClick={() => p.onPick('gmail')}>
        pick gmail
      </button>
      <button type="button" onClick={() => p.onPick('documents', { kbId: 'kb1' })}>
        pick documents
      </button>
      <button type="button" onClick={p.onMcp}>
        pick mcp
      </button>
    </div>
  ),
}))
vi.mock('@/components/sources/openConfiguration', () => ({ openConfiguration: h.openConfiguration }))
vi.mock('@/packages/sources', () => {
  class SourceRuleError extends Error {}
  const kinds: Record<string, { kind: string; supportsBackgroundReview: boolean; connectorId?: string }> = {
    folder: { kind: 'folder', supportsBackgroundReview: true },
    gmail: { kind: 'gmail', supportsBackgroundReview: true, connectorId: 'gmail' },
    documents: { kind: 'documents', supportsBackgroundReview: false },
  }
  return {
    BACKGROUND_REVIEW_LINE:
      'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.',
    MCP_SOURCE_OPTION: { to: '/settings/mcp' },
    pickSource: h.pickSource,
    connectSource: h.connectSource,
    discardSourceDraft: h.discardSourceDraft,
    draftWasDiscarded: () => false,
    getSourceKind: (kind: string) => kinds[kind],
    isOAuthClientIdError: () => false,
    SourceRuleError,
    sourceRuleErrorText: (e: Error) => e.message,
  }
})
vi.mock('@/packages/first-run/firstRun', () => ({ setFirstRun: h.setFirstRun }))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: [], addScope: h.addScope }) }))

import { SourceStep } from './SourceStep'

const FOLDER: SourceDraft = {
  kind: 'folder',
  label: 'dango',
  ref: '/Users/x/Projects/dango',
  config: {},
  draftBindingId: 'draft:1',
}
const DOCS: SourceDraft = { kind: 'documents', label: 'Specs', ref: 'Specs', config: { kbId: 'kb1' } }

function deferred<T>() {
  let resolveFn!: (v: T) => void
  let rejectFn!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

async function flush() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

function continueButton() {
  return screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
}

async function pickFolder(draft: SourceDraft | null = FOLDER) {
  h.pickSource.mockResolvedValueOnce(draft)
  fireEvent.click(screen.getByText('pick folder'))
  await flush()
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockClear()
  h.pickSource.mockReset()
})
afterEach(cleanup)

describe('SourceStep (FR2)', () => {
  it('renders the kind picker inside the FR2 card', () => {
    render(<SourceStep onNext={vi.fn()} />)
    const card = screen.getByRole('region', { name: 'Connect a source' })
    expect(card.querySelector('[data-testid="kind-picker"]')).toBeTruthy()
    expect(
      screen.getByText('A source is where Dango reads from. Pick one to start; add more later in Settings.')
    ).toBeTruthy()
    expect(screen.getByLabelText('Step 2 of 5')).toBeTruthy()
  })

  it('choosing a kind runs pickSource for that kind', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    expect(h.pickSource).toHaveBeenCalledWith('folder', expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('a cancelled pick (null) leaves nothing selected and Continue disabled', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    await pickFolder(null)
    expect(screen.queryByText('Selected:')).toBeNull()
    expect(continueButton().disabled).toBe(true)
    expect(h.connectSource).not.toHaveBeenCalled()
    // Step 2 is still usable: the list is back and another pick runs.
    expect(screen.getByTestId('kind-picker')).toBeTruthy()
    await pickFolder()
    expect(screen.getByText('Selected:')).toBeTruthy()
  })

  it('a draft shows Selected:, its label and the background review switch on', async () => {
    const onNext = vi.fn()
    render(<SourceStep onNext={onNext} />)
    await pickFolder()
    expect(screen.getByText('Selected:')).toBeTruthy()
    expect(screen.getByText('dango')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: 'Background review' })
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    expect(
      screen.getByText(
        'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'
      )
    ).toBeTruthy()
    expect(continueButton().disabled).toBe(false)
    fireEvent.click(continueButton())
    expect(onNext).toHaveBeenCalledWith(FOLDER, true)
    expect(h.connectSource).not.toHaveBeenCalled()
  })

  it('turning the switch off passes backgroundReview false', async () => {
    const onNext = vi.fn()
    render(<SourceStep onNext={onNext} />)
    await pickFolder()
    fireEvent.click(screen.getByRole('switch', { name: 'Background review' }))
    fireEvent.click(continueButton())
    expect(onNext).toHaveBeenCalledWith(FOLDER, false)
  })

  it('documents has no background review switch', async () => {
    const onNext = vi.fn()
    render(<SourceStep onNext={onNext} />)
    h.pickSource.mockResolvedValueOnce(DOCS)
    fireEvent.click(screen.getByText('pick documents'))
    await flush()
    expect(h.pickSource).toHaveBeenCalledWith('documents', expect.objectContaining({ choice: { kbId: 'kb1' } }))
    expect(screen.getByText('Selected:')).toBeTruthy()
    expect(screen.queryByRole('switch')).toBeNull()
    fireEvent.click(continueButton())
    expect(onNext).toHaveBeenCalledWith(DOCS, false)
  })

  it('"Skip for now" is ghost, records the skip and calls onNext(null, false)', () => {
    const onNext = vi.fn()
    render(<SourceStep onNext={onNext} />)
    const skip = screen.getByRole('button', { name: 'Skip for now' })
    expect(skip.className).toContain('dg-btn--ghost')
    fireEvent.click(skip)
    expect(h.setFirstRun).toHaveBeenCalledWith({ step: 3, sourceSkipped: true })
    expect(onNext).toHaveBeenCalledWith(null, false)
  })

  it('skipping after a pick discards the draft', async () => {
    const onNext = vi.fn()
    render(<SourceStep onNext={onNext} />)
    await pickFolder()
    fireEvent.click(screen.getByRole('button', { name: 'Skip for now' }))
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
    expect(onNext).toHaveBeenCalledWith(null, false)
  })

  it('"Change" discards the draft and shows the list again', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
    expect(screen.queryByText('Selected:')).toBeNull()
    expect(screen.getByTestId('kind-picker')).toBeTruthy()
    expect(continueButton().disabled).toBe(true)
  })

  it('unmounting with an unhanded draft discards it', async () => {
    const { unmount } = render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    unmount()
    await flush()
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
  })

  it('a draft handed to the next step is not discarded on unmount', async () => {
    const { unmount } = render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    fireEvent.click(continueButton())
    unmount()
    await flush()
    expect(h.discardSourceDraft).not.toHaveBeenCalled()
  })

  it('unmounting while the picker is open aborts the pick', async () => {
    const pending = deferred<SourceDraft | null>()
    h.pickSource.mockReturnValueOnce(pending.promise)
    const { unmount } = render(<SourceStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByText('pick folder'))
    const { signal } = h.pickSource.mock.calls[0][1] as { signal: AbortSignal }
    unmount()
    await flush()
    expect(signal.aborted).toBe(true)
  })

  it('while the browser is open, step 2 stays usable: Cancel aborts and nothing is selected', async () => {
    const pending = deferred<SourceDraft | null>()
    h.pickSource.mockReturnValueOnce(pending.promise)
    render(<SourceStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByText('pick gmail'))
    expect(screen.getByText('Waiting for the browser…')).toBeTruthy()
    const { signal } = h.pickSource.mock.calls[0][1] as { signal: AbortSignal }
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(signal.aborted).toBe(true)
    // The helper resolves null after an abort (the tab was closed or the pick cancelled).
    await act(async () => pending.resolve(null))
    await flush()
    expect(screen.queryByText('Waiting for the browser…')).toBeNull()
    expect(screen.queryByText('Selected:')).toBeNull()
    expect(continueButton().disabled).toBe(true)
    expect(screen.getByTestId('kind-picker')).toBeTruthy()
  })

  it('picking another kind while one is open aborts the first; its late draft is discarded', async () => {
    const first = deferred<SourceDraft | null>()
    h.pickSource.mockReturnValueOnce(first.promise)
    render(<SourceStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByText('pick gmail'))
    const { signal } = h.pickSource.mock.calls[0][1] as { signal: AbortSignal }
    await pickFolder()
    expect(signal.aborted).toBe(true)
    const late: SourceDraft = { kind: 'gmail', label: 'pm@acme.com', config: {}, createdAccountId: 'acc1' }
    await act(async () => first.resolve(late))
    await flush()
    expect(h.discardSourceDraft).toHaveBeenCalledWith(late)
    expect(screen.getByText('dango')).toBeTruthy()
  })

  it('a pick that fails (browser closed, sign-in timed out) shows the error and keeps step 2 usable', async () => {
    h.pickSource.mockRejectedValueOnce(new Error('OAuth callback timed out\nmore detail'))
    render(<SourceStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByText('pick gmail'))
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('OAuth callback timed out')
    expect(screen.queryByText('Selected:')).toBeNull()
    expect(continueButton().disabled).toBe(true)
    expect(screen.getByTestId('kind-picker')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Skip for now' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows an error handed back from step 3', () => {
    render(<SourceStep onNext={vi.fn()} error={{ text: 'This folder already belongs to Acme.' }} />)
    expect(screen.getByRole('alert').textContent).toContain('This folder already belongs to Acme.')
  })

  it('MCP server opens MCP settings', () => {
    render(<SourceStep onNext={vi.fn()} />)
    fireEvent.click(screen.getByText('pick mcp'))
    expect(h.openConfiguration).toHaveBeenCalledWith('/settings/mcp')
  })

  it('nothing in this step connects a source or creates a scope', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    fireEvent.click(continueButton())
    expect(h.connectSource).not.toHaveBeenCalled()
    expect(h.addScope).not.toHaveBeenCalled()
    const source = readFileSync(resolve(__dirname, 'SourceStep.tsx'), 'utf8')
    expect(source).not.toMatch(/connectSource|addScope/)
  })

  it('after a pick, focus goes to Continue', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    screen.getByText('pick folder').focus()
    await pickFolder()
    expect(document.activeElement).toBe(continueButton())
  })

  it('after "Change", focus goes to the first enabled kind row', async () => {
    render(<SourceStep onNext={vi.fn()} />)
    await pickFolder()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(document.activeElement).toBe(screen.getByText('pick folder'))
  })

  it('coming back from step 3, focus goes to the first enabled kind row', () => {
    render(<SourceStep onNext={vi.fn()} returned error={{ text: 'This folder already belongs to Acme.' }} />)
    expect(document.activeElement).toBe(screen.getByText('pick folder'))
  })

  it('a first visit starts at the step title, not in the list (T4 M2: never the body)', () => {
    render(<SourceStep onNext={vi.fn()} />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })
})

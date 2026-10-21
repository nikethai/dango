// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import type { Scope } from '@shared/types'
import type { SourceDraft } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/components/brand/Mascot', () => ({ Mascot: () => <svg /> }))

const h = vi.hoisted(() => ({
  scopes: [] as Scope[],
  addScope: vi.fn(),
  connectSource: vi.fn(),
  discardSourceDraft: vi.fn(async () => {}),
  setFirstRun: vi.fn(),
  addReviewEntry: vi.fn(),
}))

vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: h.scopes, addScope: h.addScope }) }))
vi.mock('@/packages/sources', () => {
  class SourceRuleError extends Error {
    code = 'folder-taken'
  }
  return {
    connectSource: h.connectSource,
    discardSourceDraft: h.discardSourceDraft,
    draftWasDiscarded: (e: unknown) => e instanceof SourceRuleError,
    isOAuthClientIdError: () => false,
    SourceRuleError,
    sourceRuleErrorText: () => 'This folder already belongs to another scope.',
  }
})
vi.mock('@/packages/first-run/firstRun', () => ({ setFirstRun: h.setFirstRun }))
vi.mock('@/packages/review', () => ({ addReviewEntry: h.addReviewEntry }))

import { SourceRuleError } from '@/packages/sources'
import { ScopeStep } from './ScopeStep'

vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
)
vi.stubGlobal(
  'matchMedia',
  vi.fn(() => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
)

const FOLDER: SourceDraft = { kind: 'folder', label: 'dango', ref: '/Users/x/Projects/dango', config: {} }
const GMAIL: SourceDraft = { kind: 'gmail', label: 'pm@acme.com', ref: 'pm@acme.com', config: { accountId: 'a1' } }

function renderStep(
  props: {
    draft: SourceDraft | null
    backgroundReview?: boolean
    onDraftLost?: (e: { text: string }) => void
    onBack?: () => void
  } = { draft: FOLDER }
) {
  return render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ScopeStep
        draft={props.draft}
        backgroundReview={props.backgroundReview ?? true}
        onDraftLost={props.onDraftLost}
        onBack={props.onBack}
      />
    </MantineProvider>
  )
}

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

function nameField() {
  return screen.getByLabelText('Name') as HTMLInputElement
}
function continueButton() {
  return screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement
}
function checkedKind() {
  return (screen.getByRole('radio', { checked: true }) as HTMLInputElement).value
}
async function clickContinue() {
  await act(async () => {
    fireEvent.click(continueButton())
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  h.scopes = []
  h.addScope.mockReset()
  h.addScope.mockImplementation((input: { name: string; kind: string }) => ({ id: 'scope-new', order: 0, ...input }))
  h.connectSource.mockReset()
  h.connectSource.mockResolvedValue({ sourceId: 'src-1', jobId: 'job-1' })
  h.discardSourceDraft.mockClear()
  h.setFirstRun.mockClear()
  h.addReviewEntry.mockClear()
})
afterEach(cleanup)

describe('ScopeStep (FR3)', () => {
  it('renders the FR3 card with the suggested name and the kind preselected', () => {
    renderStep({ draft: FOLDER })
    expect(screen.getByRole('heading', { level: 1, name: 'Name this scope' })).toBeTruthy()
    expect(
      screen.getByText(
        'A scope is one project or one client. Everything Dango learns from this source stays inside it.'
      )
    ).toBeTruthy()
    expect(screen.getByLabelText('Step 3 of 5')).toBeTruthy()
    expect(nameField().value).toBe('dango')
    expect(checkedKind()).toBe('project')
    expect(screen.getByText('Is this a project or a client?')).toBeTruthy()
  })

  it('preselects client for gmail with the domain as name', () => {
    renderStep({ draft: GMAIL })
    expect(nameField().value).toBe('Acme')
    expect(checkedKind()).toBe('client')
  })

  it('shows the client caption', () => {
    renderStep({ draft: FOLDER })
    expect(screen.getByText("Client scopes don't read your Everywhere documents unless you turn that on.")).toBeTruthy()
  })

  it('disables Continue for a blank name', () => {
    renderStep({ draft: FOLDER })
    fireEvent.change(nameField(), { target: { value: '   ' } })
    expect(continueButton().disabled).toBe(true)
  })

  it('rejects the reserved name Everywhere without a reuse hint', () => {
    renderStep({ draft: FOLDER })
    fireEvent.change(nameField(), { target: { value: 'everywhere' } })
    expect(screen.getByText('Everywhere is built in. Pick another name.')).toBeTruthy()
    expect(screen.queryByText(/already exists/)).toBeNull()
    expect(continueButton().disabled).toBe(true)
  })

  it('creates the scope, connects the draft and moves to step 4', async () => {
    renderStep({ draft: FOLDER, backgroundReview: true })
    await clickContinue()
    expect(h.addScope).toHaveBeenCalledWith({ name: 'dango', kind: 'project' })
    expect(h.connectSource).toHaveBeenCalledWith(FOLDER, { scopeId: 'scope-new', backgroundReview: true })
    expect(h.addScope.mock.invocationCallOrder[0]).toBeLessThan(h.connectSource.mock.invocationCallOrder[0])
    expect(h.setFirstRun).toHaveBeenCalledWith({
      step: 4,
      scopeId: 'scope-new',
      firstReadJobId: 'job-1',
      firstReadSourceId: 'src-1',
    })
  })

  it('passes the chosen kind, so Everywhere reads follow everywhereDefaults(kind)', async () => {
    renderStep({ draft: FOLDER, backgroundReview: false })
    fireEvent.click(screen.getByLabelText('Client'))
    await clickContinue()
    expect(h.addScope).toHaveBeenCalledWith({ name: 'dango', kind: 'client' })
    expect(h.connectSource).toHaveBeenCalledWith(FOLDER, { scopeId: 'scope-new', backgroundReview: false })
  })

  it('reuses an existing scope with the same name (case-insensitive)', async () => {
    h.scopes = [{ id: 'scope-dango', name: 'Dango', kind: 'project', order: 0 } as Scope]
    renderStep({ draft: FOLDER })
    expect(screen.getByText('Dango already exists. Continue adds this source to it.')).toBeTruthy()
    await clickContinue()
    expect(h.addScope).not.toHaveBeenCalled()
    expect(h.connectSource).toHaveBeenCalledWith(FOLDER, { scopeId: 'scope-dango', backgroundReview: true })
    expect(h.setFirstRun).toHaveBeenCalledWith(expect.objectContaining({ step: 4, scopeId: 'scope-dango' }))
  })

  it('without a draft the field is empty and nothing is connected', async () => {
    renderStep({ draft: null })
    expect(nameField().value).toBe('')
    expect(continueButton().disabled).toBe(true)
    fireEvent.change(nameField(), { target: { value: 'Acme' } })
    await clickContinue()
    expect(h.addScope).toHaveBeenCalledWith({ name: 'Acme', kind: 'project' })
    expect(h.connectSource).not.toHaveBeenCalled()
    expect(h.setFirstRun).toHaveBeenCalledWith({ step: 4, scopeId: 'scope-new' })
  })

  it('a failed connect keeps the step open with the error, keeps the scope, and adds no Needs you entry', async () => {
    h.connectSource.mockRejectedValueOnce(new Error('Could not read the folder.'))
    renderStep({ draft: FOLDER })
    await clickContinue()
    expect(screen.getByRole('alert').textContent).toContain('Could not read the folder.')
    expect(h.addScope).toHaveBeenCalledTimes(1)
    expect(h.setFirstRun).not.toHaveBeenCalled()
    expect(h.addReviewEntry).not.toHaveBeenCalled()
    expect(continueButton().disabled).toBe(false)
  })

  it('retrying after a failed connect does not create the scope twice', async () => {
    h.connectSource.mockRejectedValueOnce(new Error('Could not read the folder.'))
    const view = renderStep({ draft: FOLDER })
    await clickContinue()
    // The store now has the scope it created.
    h.scopes = [{ id: 'scope-new', name: 'dango', kind: 'project', order: 0 } as Scope]
    view.rerender(
      <MantineProvider theme={createDangoMantineTheme()}>
        <ScopeStep draft={FOLDER} backgroundReview />
      </MantineProvider>
    )
    await clickContinue()
    expect(h.addScope).toHaveBeenCalledTimes(1)
    expect(h.connectSource).toHaveBeenLastCalledWith(FOLDER, { scopeId: 'scope-new', backgroundReview: true })
    expect(h.setFirstRun).toHaveBeenCalledWith(expect.objectContaining({ step: 4, scopeId: 'scope-new' }))
  })

  it('a rule error that discarded the draft goes back to step 2 with the error; the scope stays', async () => {
    h.connectSource.mockRejectedValueOnce(new SourceRuleError('folder-taken'))
    const onDraftLost = vi.fn()
    const { unmount } = renderStep({ draft: FOLDER, onDraftLost })
    await clickContinue()
    expect(onDraftLost).toHaveBeenCalledWith({ text: 'This folder already belongs to another scope.' })
    expect(h.addScope).toHaveBeenCalledTimes(1)
    expect(h.setFirstRun).not.toHaveBeenCalled()
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    // connectSource already discarded it.
    expect(h.discardSourceDraft).not.toHaveBeenCalled()
  })

  it('leaving the step without connecting discards the draft', async () => {
    const { unmount } = renderStep({ draft: FOLDER })
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
  })

  it('a connected draft is not discarded when the step goes away', async () => {
    const { unmount } = renderStep({ draft: FOLDER })
    await clickContinue()
    unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(h.discardSourceDraft).not.toHaveBeenCalled()
  })

  it('unmounting while connecting never discards the draft being attached', async () => {
    const pending = deferred<{ sourceId: string; jobId?: string }>()
    h.connectSource.mockReturnValueOnce(pending.promise)
    const { unmount } = renderStep({ draft: FOLDER })
    await clickContinue()
    unmount()
    await flush()
    expect(h.discardSourceDraft).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ sourceId: 'src-1', jobId: 'job-1' }))
    await flush()
    expect(h.discardSourceDraft).not.toHaveBeenCalled()
  })

  it('a connect that fails after the step went away discards the draft it kept', async () => {
    const pending = deferred<{ sourceId: string; jobId?: string }>()
    h.connectSource.mockReturnValueOnce(pending.promise)
    const { unmount } = renderStep({ draft: FOLDER })
    await clickContinue()
    unmount()
    await flush()
    await act(async () => pending.reject(new Error('Could not read the folder.')))
    await flush()
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
  })

  it('a reused scope shows its own kind and the choice is disabled', () => {
    h.scopes = [{ id: 'scope-dango', name: 'Dango', kind: 'client', order: 0 } as Scope]
    renderStep({ draft: FOLDER })
    expect(checkedKind()).toBe('client')
    expect((screen.getByLabelText('Project') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Client') as HTMLInputElement).disabled).toBe(true)
    // A new name brings the choice back, at the suggested kind.
    fireEvent.change(nameField(), { target: { value: 'Other' } })
    expect(checkedKind()).toBe('project')
    expect((screen.getByLabelText('Client') as HTMLInputElement).disabled).toBe(false)
  })

  it('"Change" (ghost) discards the draft and goes back to step 2', async () => {
    const onBack = vi.fn()
    const { unmount } = renderStep({ draft: FOLDER, onBack })
    const change = screen.getByRole('button', { name: 'Change' })
    expect(change.className).toContain('dg-btn--ghost')
    fireEvent.click(change)
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
    expect(onBack).toHaveBeenCalled()
    expect(h.addScope).not.toHaveBeenCalled()
    unmount()
    await flush()
    // Not discarded a second time on the way out.
    expect(h.discardSourceDraft).toHaveBeenCalledTimes(1)
  })

  it('"Change" stays available after a failed connect; the scope created stays', async () => {
    h.connectSource.mockRejectedValueOnce(new Error('Could not read the folder.'))
    const onBack = vi.fn()
    renderStep({ draft: FOLDER, onBack })
    await clickContinue()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(onBack).toHaveBeenCalled()
    expect(h.discardSourceDraft).toHaveBeenCalledWith(FOLDER)
    expect(h.addScope).toHaveBeenCalledTimes(1)
  })

  it('has no "Change" without a draft', () => {
    renderStep({ draft: null, onBack: vi.fn() })
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
  })
})

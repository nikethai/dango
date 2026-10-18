/**
 * @vitest-environment jsdom
 */
import type { KnowledgeConflict, KnowledgeProposal } from '@shared/types/knowledge'
import { emptyKnowledgeState } from '@shared/types/knowledge'
import type { ReviewEntry } from '@shared/types/review'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getReviewRenderer, openReviewEntry, registerReviewOpener, registerReviewRenderer } from '@/packages/review'
import * as toastActions from '@/stores/toastActions'
import { approveProposal, KnowledgeConflictError } from '../approve'
import { resolveConflict } from '../conflicts'
import { reapproveKnowledge } from '../lifecycle'
import { dismissProposal } from '../proposals'
import { knowledgeStore } from '../store'
import { makeItem } from '../test-storage'
import { ConflictRenderer } from './ConflictRenderer'
import { KeepBothSheet } from './KeepBothSheet'
import { ProposalRenderer } from './ProposalRenderer'
import { RecheckRenderer } from './RecheckRenderer'
import { registerKnowledgeRenderers } from './register'

vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('../approve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../approve')>()),
  approveProposal: vi.fn(async () => undefined),
}))
vi.mock('../conflicts', () => ({ resolveConflict: vi.fn(async () => undefined) }))
vi.mock('../lifecycle', () => ({ reapproveKnowledge: vi.fn(async () => undefined) }))
vi.mock('../proposals', () => ({ dismissProposal: vi.fn(async () => ({ offerDontSuggest: false })) }))
vi.mock('@/packages/review', async (importOriginal) => {
  const orig = await importOriginal<typeof import('@/packages/review')>()
  return {
    ...orig,
    setReviewEntryState: vi.fn(async () => undefined),
    openReviewEntry: vi.fn(async () => false),
    registerReviewRenderer: vi.fn(orig.registerReviewRenderer),
    registerReviewOpener: vi.fn(orig.registerReviewOpener),
  }
})

const { setReviewEntryState } = await import('@/packages/review')

const entry = (over: Partial<ReviewEntry>): ReviewEntry => ({
  id: 'r1',
  kind: 'proposal',
  scopeId: 'acme',
  text: 'Launch is 6 Nov',
  ref: { type: 'proposal', id: 'p1' },
  state: 'open',
  createdAt: 1,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('ProposalRenderer', () => {
  it('Edit then Cmd+Enter approves the edited text', () => {
    render(<ProposalRenderer entry={entry({})} focused={false} />)
    fireEvent.click(screen.getByText('Edit'))
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: 'Launch is 7 Nov' } })
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
    expect(approveProposal).toHaveBeenCalledWith('p1', { text: 'Launch is 7 Nov' })
  })

  it('Cancel leaves editing without approving', () => {
    render(<ProposalRenderer entry={entry({})} focused={false} />)
    fireEvent.click(screen.getByText('Edit'))
    fireEvent.click(screen.getByText('Cancel'))
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(approveProposal).not.toHaveBeenCalled()
  })

  it('Approve, Dismiss', () => {
    render(<ProposalRenderer entry={entry({})} focused={false} />)
    fireEvent.click(screen.getByText('Approve'))
    expect(approveProposal).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByText('Dismiss'))
    expect(dismissProposal).toHaveBeenCalledWith('p1')
  })

  it('a contradiction shows the waiting toast', async () => {
    const conflict = { id: 'c' } as KnowledgeConflict
    vi.mocked(approveProposal).mockRejectedValueOnce(new KnowledgeConflictError(conflict, 'Launch is 4 Nov'))
    render(<ProposalRenderer entry={entry({})} focused={false} />)
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() =>
      expect(toastActions.add).toHaveBeenCalledWith('Waiting in Review: it contradicts "Launch is 4 Nov"')
    )
  })
})

describe('ConflictRenderer', () => {
  beforeEach(async () => {
    const old = await makeItem({
      id: 'old',
      scopeId: 'acme',
      text: 'Launch is 4 Nov',
      sources: [{ id: 's1', kind: 'chat', label: 'Kickoff' }],
    })
    const proposal: KnowledgeProposal = {
      id: 'p1',
      scopeId: 'acme',
      kind: 'fact',
      text: 'Launch is 6 Nov',
      sources: [{ kind: 'chat', label: 'Launch planning' }],
      origin: 'chat',
      createdAt: Date.UTC(2026, 9, 12, 12),
    }
    const conflict: KnowledgeConflict = {
      id: 'c1',
      scopeId: 'acme',
      proposalId: 'p1',
      itemIds: ['old'],
      state: 'open',
      createdAt: 3,
    }
    knowledgeStore.setState({
      state: { ...emptyKnowledgeState(), items: [old], proposals: [proposal], conflicts: [conflict] },
    })
  })
  const conflictEntry = () => entry({ kind: 'conflict', ref: { type: 'conflict', id: 'c1' } })

  it('shows both statements; the second Keep this keeps the saved one', () => {
    const { container } = render(<ConflictRenderer entry={conflictEntry()} focused={false} />)
    expect(container.querySelector('.dg-item--conflict')).not.toBeNull()
    expect(screen.getByText('Launch is 6 Nov')).toBeTruthy()
    expect(screen.getByText('Launch is 4 Nov')).toBeTruthy()
    expect(screen.getByText(/Launch planning/)).toBeTruthy()
    expect(screen.getByText(/12 Oct/)).toBeTruthy()
    const keeps = screen.getAllByText('Keep this')
    expect(keeps).toHaveLength(2)
    fireEvent.click(keeps[0])
    expect(resolveConflict).toHaveBeenCalledWith('c1', { keep: 'p1' })
    fireEvent.click(keeps[1])
    expect(resolveConflict).toHaveBeenCalledWith('c1', { keep: 'old' })
  })

  it('Dismiss dismisses the proposal; Keep both opens the sheet', async () => {
    render(<ConflictRenderer entry={conflictEntry()} focused={false} />)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(dismissProposal).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByText('Keep both, with a condition…'))
    const field = await screen.findByLabelText('Condition')
    expect(document.activeElement).toBe(field)
    fireEvent.change(field, { target: { value: 'for the EU launch' } })
    fireEvent.click(screen.getByText('Keep both'))
    expect(resolveConflict).toHaveBeenCalledWith('c1', { keepBoth: 'for the EU launch' })
  })
})

describe('KeepBothSheet', () => {
  it('is disabled for a blank condition and confirms a real one', () => {
    const onConfirm = vi.fn()
    render(<KeepBothSheet opened onClose={() => {}} onConfirm={onConfirm} />)
    const button = screen.getByText('Keep both') as HTMLButtonElement
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: '   ' } })
    expect(button.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Condition'), { target: { value: 'for the EU launch' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    expect(onConfirm).toHaveBeenCalledWith('for the EU launch')
  })
})

describe('RecheckRenderer', () => {
  it('Open opens the entry; Dismiss dismisses it', () => {
    const e = entry({ kind: 're-check', ref: { type: 'draft', id: 'd1' } })
    render(<RecheckRenderer entry={e} focused={false} />)
    fireEvent.click(screen.getByText('Open'))
    expect(openReviewEntry).toHaveBeenCalledWith(e)
    fireEvent.click(screen.getByText('Dismiss'))
    expect(setReviewEntryState).toHaveBeenCalledWith({ id: 'r1' }, 'dismissed')
  })

  it('a knowledge ref offers Approve again', () => {
    render(
      <RecheckRenderer entry={entry({ kind: 're-check', ref: { type: 'knowledge', id: 'k1' } })} focused={false} />
    )
    fireEvent.click(screen.getByText('Approve again'))
    expect(reapproveKnowledge).toHaveBeenCalledWith('k1')
    expect(screen.getByText('Open')).toBeTruthy()
  })
})

describe('registerKnowledgeRenderers', () => {
  it('registers the three renderers and the knowledge opener; a draft proposal gets none', async () => {
    const off = registerKnowledgeRenderers()
    expect(registerReviewRenderer).toHaveBeenCalledTimes(3)
    expect(registerReviewRenderer).toHaveBeenCalledWith('proposal', ProposalRenderer, { refType: 'proposal' })
    expect(registerReviewRenderer).toHaveBeenCalledWith('conflict', ConflictRenderer, { refType: 'conflict' })
    expect(registerReviewRenderer).toHaveBeenCalledWith('re-check', RecheckRenderer)
    expect(registerReviewOpener).toHaveBeenCalledWith('knowledge', expect.any(Function))
    expect(getReviewRenderer(entry({}))).toBe(ProposalRenderer)
    expect(getReviewRenderer(entry({ ref: { type: 'draft', id: 'd' } }))).toBeUndefined()
    off()
    expect(getReviewRenderer(entry({}))).toBeUndefined()
    await act(async () => undefined)
  })
})

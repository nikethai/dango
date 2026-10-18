/**
 * @vitest-environment jsdom
 */
import type { KnowledgeConflict, KnowledgeProposal } from '@shared/types/knowledge'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { approveProposal, KnowledgeConflictError } from '@/packages/knowledge/approve'
import { useProposalConflictText, useProposalsForMessage } from '@/packages/knowledge/hooks'
import { deferProposal } from '@/packages/knowledge/proposals'
import * as toastActions from '@/stores/toastActions'
import { KnowledgeProposalCard } from './KnowledgeProposalCard'

vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? '')),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/packages/knowledge/hooks', () => ({
  useProposalsForMessage: vi.fn(() => []),
  useProposalConflictText: vi.fn(() => undefined),
}))
vi.mock('@/packages/knowledge/approve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/knowledge/approve')>()),
  approveProposal: vi.fn(async () => undefined),
}))
vi.mock('@/packages/knowledge/proposals', () => ({ deferProposal: vi.fn(async () => undefined) }))
vi.mock('@/packages/knowledge/scopes', () => ({
  scopeName: (id: string) => (id === 'everywhere' ? 'Everywhere' : 'Acme'),
}))

const proposal = (over: Partial<KnowledgeProposal>): KnowledgeProposal => ({
  id: 'p1',
  scopeId: 'acme',
  kind: 'fact',
  text: 'Launch is 6 Nov',
  sources: [{ kind: 'chat', label: 'Launch planning', ref: 's1' }],
  origin: 'chat',
  createdAt: 1,
  sessionId: 's1',
  messageId: 'm1',
  ...over,
})

const show = (list: KnowledgeProposal[]) => vi.mocked(useProposalsForMessage).mockReturnValue(list)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useProposalsForMessage).mockReturnValue([])
  vi.mocked(useProposalConflictText).mockReturnValue(undefined)
})
afterEach(cleanup)

describe('KnowledgeProposalCard', () => {
  it('renders nothing without proposals', () => {
    const { container } = render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    expect(container.innerHTML).toBe('')
  })

  it('two proposals show two Approve buttons; clicking one approves it', () => {
    show([proposal({ id: 'p1' }), proposal({ id: 'p2', text: 'Budget is 40k' })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    const buttons = screen.getAllByText('Approve')
    expect(buttons).toHaveLength(2)
    expect(screen.getAllByText('Save to Acme?')).toHaveLength(2)
    fireEvent.click(buttons[1])
    expect(approveProposal).toHaveBeenCalledWith('p2')
    expect(approveProposal).toHaveBeenCalledTimes(1)
  })

  it('Not now defers the proposal', () => {
    show([proposal({ id: 'p1' })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    fireEvent.click(screen.getByText('Not now'))
    expect(deferProposal).toHaveBeenCalledWith('p1')
  })

  it('deferred proposals are not shown', () => {
    show([proposal({ id: 'p1', deferred: true })])
    const { container } = render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    expect(container.innerHTML).toBe('')
  })

  it('a rejected KnowledgeConflictError replaces the buttons with the waiting line', async () => {
    vi.mocked(approveProposal).mockRejectedValueOnce(
      new KnowledgeConflictError({ id: 'c' } as KnowledgeConflict, 'Launch is 4 Nov')
    )
    show([proposal({ id: 'p1' })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => expect(screen.getByText('Waiting in Review: it contradicts "Launch is 4 Nov"')).toBeTruthy())
    expect(screen.queryByText('Approve')).toBeNull()
    expect(toastActions.add).not.toHaveBeenCalled()
  })

  it('a proposal that already has a conflict shows the waiting line', () => {
    vi.mocked(useProposalConflictText).mockReturnValue('Launch is 4 Nov')
    show([proposal({ id: 'p1', conflictsWith: ['old'] })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    expect(screen.getByText('Waiting in Review: it contradicts "Launch is 4 Nov"')).toBeTruthy()
    expect(screen.queryByText('Approve')).toBeNull()
  })

  it('any other failure toasts that it could not save', async () => {
    vi.mocked(approveProposal).mockRejectedValueOnce(new Error('disk'))
    show([proposal({ id: 'p1' })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    fireEvent.click(screen.getByText('Approve'))
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith("Couldn't save that. Try again."))
    expect(screen.getByText('Approve')).toBeTruthy()
  })

  it('a double click approves once', () => {
    vi.mocked(approveProposal).mockImplementationOnce(() => new Promise(() => undefined))
    show([proposal({ id: 'p1' })])
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    const approve = screen.getByText('Approve')
    fireEvent.click(approve)
    fireEvent.click(approve)
    expect(approveProposal).toHaveBeenCalledTimes(1)
  })

  it('five proposals show three rows and 2 more in Review', () => {
    show([1, 2, 3, 4, 5].map((n) => proposal({ id: `p${n}`, text: `Fact ${n}`, createdAt: n })))
    render(<KnowledgeProposalCard sessionId="s1" messageId="m1" />)
    expect(screen.getAllByText('Approve')).toHaveLength(3)
    expect(screen.getByText('2 more in Review')).toBeTruthy()
    expect(screen.queryByText('Fact 4')).toBeNull()
  })
})

// @vitest-environment jsdom
import type { ReviewEntry } from '@shared/types/review'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type UndoArg = { message: string; silent?: boolean; undo: () => Promise<void> }
const undoMock = vi.hoisted(() => ({
  pushUndo: vi.fn((_input: UndoArg) => 'rec-1'),
  canUndo: vi.fn(() => true),
  undoEntry: vi.fn(async (_id: string) => true),
  DEFAULT_UNDO_MS: 5000,
}))
vi.mock('@/packages/undo', () => undoMock)
vi.mock('./bridge', async () => {
  const review = await vi.importActual<typeof import('@/packages/review')>('@/packages/review')
  return {
    addReviewEntry: review.addReviewEntry,
    applyReviewEntry: review.applyReviewEntry,
    listReviewEntries: review.listReviewEntries,
    registerReviewApplier: review.registerReviewApplier,
    registerReviewOpener: review.registerReviewOpener,
    setReviewEntryState: review.setReviewEntryState,
    subscribeReviewEntries: review.subscribeReviewEntries,
    updateReviewEntry: review.updateReviewEntry,
    getScope: vi.fn(async () => undefined),
    recordKnowledgeUse: vi.fn(async () => undefined),
  }
})
vi.mock('./tokens', () => ({ getFreshToken: vi.fn(async () => ({ ok: false, message: 'no' })) }))
vi.mock('./sent-readback', () => ({ proposeFactChanges: vi.fn(async () => 0) }))
vi.mock('./background-model', () => ({
  errorClassName: () => undefined,
  resolveBackgroundModel: vi.fn(async () => null),
  localOnlySourceIds: vi.fn(async () => new Set()),
}))

import { addReviewEntry, setReviewStorageForTests } from '@/packages/review/store'
import { setReviewApplierForTests } from '@/packages/review/trust'
import { DraftEditSheet } from './DraftEditSheet'
import { _resetPmStoreForTests, pmStore } from './store'

const KEY = 'review-entries'
let data: Record<string, unknown>
const stored = (): ReviewEntry => (data[KEY] as { entries: ReviewEntry[] }).entries[0] as ReviewEntry
const apply = vi.fn(async (_e: ReviewEntry) => {})

const BODY = 'Hi Jo,\n\nThe launch is on 4 Nov. <b>not markup</b>'
let entry: ReviewEntry

beforeEach(async () => {
  data = {}
  setReviewStorageForTests({
    getItem: <T,>(k: string, f: T) => Promise.resolve((data[k] as T) ?? f),
    setItemNow: (k: string, v: unknown) => {
      data[k] = JSON.parse(JSON.stringify(v))
      return Promise.resolve()
    },
  })
  apply.mockClear()
  _resetPmStoreForTests()
  await pmStore.saveDraft({
    id: 'd1',
    scopeId: 'acme',
    accountId: 'acc1',
    threadId: 't1',
    inboundMessageId: 'm1',
    to: 'jo@acme.com',
    subject: 'Launch',
    text: BODY,
    answer: '4 Nov',
    evidence: [],
    state: 'proposed',
    createdAt: 1,
  })
  undoMock.pushUndo.mockClear()
  setReviewApplierForTests('draft', { apply, undo: vi.fn(async () => {}) })
  entry = await addReviewEntry({
    kind: 'proposal',
    scopeId: 'acme',
    source: 'Gmail thread "Launch"',
    text: BODY,
    sub: 'Not in Gmail yet · per your 2 Oct email',
    ref: { type: 'draft', id: 'd1' },
    risk: 'risky',
    actionLabel: 'Apply',
  })
})

afterEach(() => {
  cleanup()
  setReviewApplierForTests('draft', undefined)
  setReviewStorageForTests(null)
})

describe('DraftEditSheet', () => {
  it('first focus is the text area, labelled, holding the draft as plain text', () => {
    render(<DraftEditSheet opened entry={entry} onClose={() => {}} />)
    const area = screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement
    expect(document.activeElement).toBe(area)
    expect(area.value).toBe(BODY)
    expect(screen.getByRole('dialog', { name: 'Edit the reply' })).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
  })

  it('Apply writes the edited text, closes and pushes an undo', async () => {
    const onClose = vi.fn()
    render(<DraftEditSheet opened entry={entry} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'Hi Jo, it is 6 Nov.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ id: entry.id, text: 'Hi Jo, it is 6 Nov.' }))
    expect((await pmStore.getDraft('d1'))?.editedText).toBe('Hi Jo, it is 6 Nov.')
    expect(stored()).toMatchObject({ kind: 'done', state: 'done', text: 'Hi Jo, it is 6 Nov.' })
    expect(undoMock.pushUndo).toHaveBeenCalledWith(
      expect.objectContaining({ silent: false, message: 'Reply drafted in Gmail' })
    )
  })

  it('a failed apply keeps the sheet open with a plain reason', async () => {
    apply.mockRejectedValueOnce(new Error('nope'))
    const onClose = vi.fn()
    render(<DraftEditSheet opened entry={entry} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    await screen.findByText("Couldn't draft the reply in Gmail. Nothing was sent.")
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Cancel changes nothing', () => {
    const onClose = vi.fn()
    render(<DraftEditSheet opened entry={entry} onClose={onClose} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: 'changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(stored()).toMatchObject({ kind: 'proposal', state: 'open', text: BODY })
  })

  it('Esc changes nothing', () => {
    const onClose = vi.fn()
    render(<DraftEditSheet opened entry={entry} onClose={onClose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
    expect(apply).not.toHaveBeenCalled()
    expect(stored().text).toBe(BODY)
  })

  it('Apply is off while the reply is empty', () => {
    render(<DraftEditSheet opened entry={entry} onClose={() => {}} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Reply' }), { target: { value: '   ' } })
    expect((screen.getByRole('button', { name: 'Apply' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

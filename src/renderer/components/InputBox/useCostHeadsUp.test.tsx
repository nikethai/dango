/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))
const settings = vi.hoisted(() => ({ state: { costWarningUsd: 0.5 } as Record<string, unknown> }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => settings.state } }))

import type { CostEstimateInput } from '@/packages/cost-tracking/headsUp'
import { useCostHeadsUp } from './useCostHeadsUp'

afterEach(cleanup)

// gpt-4o: 275 616 input at $2.50/M + 4 096 output at $10/M = $0.73
const OVER: CostEstimateInput = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  inputTokens: 275_616,
  maxOutputTokens: 4_096,
  runs: 1,
}
const UNDER: CostEstimateInput = { ...OVER, inputTokens: 1_000 }

let api: ReturnType<typeof useCostHeadsUp>
function Harness() {
  api = useCostHeadsUp()
  return <>{api.sheet}</>
}

/** Asks, lets the sheet render, and hands back the pending answer (wrapped so await doesn't wait for it). */
function ask(input: CostEstimateInput & { modelName?: string }) {
  let answer!: Promise<boolean>
  act(() => {
    answer = api.confirm(input)
  })
  return { answer }
}

describe('useCostHeadsUp (CS1)', () => {
  it('over the limit opens a sheet; Run resolves true', async () => {
    render(<Harness />)
    const { answer } = ask(OVER)
    expect(screen.getByRole('dialog', { name: 'This run may cost about $0.73' })).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Cancel', 'Run'])
    expect(document.activeElement?.textContent).toBe('Run')
    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Cancel resolves false', async () => {
    render(<Harness />)
    const { answer } = ask(OVER)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await expect(answer).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Escape resolves false', async () => {
    render(<Harness />)
    const { answer } = ask(OVER)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await expect(answer).resolves.toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('under the limit resolves true without opening', async () => {
    render(<Harness />)
    const { answer } = ask(UNDER)
    await expect(answer).resolves.toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the model, the tokens and the limit', () => {
    render(<Harness />)
    ask({ ...OVER, modelName: 'GPT-4o' })
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain(`GPT-4o · about ${(279_712).toLocaleString()} tokens.`)
    expect(dialog.textContent).toContain(
      'You asked to hear about runs over $0.50. Change the limit in Settings › Models and keys.'
    )
  })
})

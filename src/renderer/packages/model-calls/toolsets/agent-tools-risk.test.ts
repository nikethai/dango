import { ToolRiskTier } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({
        extension: { browserAgent: { enabled: true, allowlist: [] }, computerUse: { enabled: true } },
      }),
    }),
  },
}))
vi.mock('@/stores/browserAgentUiStore', () => ({
  browserAgentUiStore: { getState: () => ({ setStatus: vi.fn(), patchStatus: vi.fn() }) },
}))
vi.mock('@/stores/computerUseUiStore', () => ({
  computerUseUiStore: { getState: () => ({ setStatus: vi.fn(), patchStatus: vi.fn() }) },
}))

import { getToolRiskTier } from '@/packages/tools/risk-engine'
import { createBrowserToolSet } from './browser'
import { createComputerToolSet } from './computer'

const L = { builtin: true }

function descriptions(tools: Record<string, unknown>): [string, string | undefined][] {
  return Object.entries(tools).map(([name, t]) => [name, (t as { description?: string }).description])
}

const computerTools = descriptions(createComputerToolSet({ sessionId: 's1', allowAct: true } as never).tools)
const browserTools = descriptions(createBrowserToolSet({ sessionId: 's1' }).tools)

describe('computer and browser tool risk with their real descriptions', () => {
  it('computer_ax_query reads screen text: MEDIUM, not CRITICAL', () => {
    const description = computerTools.find(([name]) => name === 'computer_ax_query')?.[1]
    expect(description).toBeTruthy()
    expect(getToolRiskTier('computer_ax_query', description, undefined, L)).toBe(ToolRiskTier.MEDIUM)
  })

  it('computer_wait: MEDIUM, not CRITICAL', () => {
    const description = computerTools.find(([name]) => name === 'computer_wait')?.[1]
    expect(getToolRiskTier('computer_wait', description, undefined, L)).toBe(ToolRiskTier.MEDIUM)
  })

  it.each([...computerTools, ...browserTools])(
    '%s: its description never names a riskier sibling, so it rates as its name does',
    (name, description) => {
      expect(getToolRiskTier(name, description, undefined, L)).toBe(getToolRiskTier(name, undefined, undefined, L))
    }
  )
})

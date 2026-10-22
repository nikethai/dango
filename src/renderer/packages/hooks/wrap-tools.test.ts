import type { ToolSet } from 'ai'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runHooks = vi.fn()
const loadHookOverrides = vi.fn()
const mergeHooksList = vi.fn()
const pushHookAudit = vi.fn()

vi.mock('./executor', () => ({
  runHooks: (...args: unknown[]) => runHooks(...args),
}))

vi.mock('@/stores/hooksStore', () => ({
  loadHookOverrides: () => loadHookOverrides(),
  mergeHooksList: (...args: unknown[]) => mergeHooksList(...args),
  pushHookAudit: (...args: unknown[]) => pushHookAudit(...args),
}))

import { wrapToolsWithLifecycleHooks } from './wrap-tools'

describe('wrapToolsWithLifecycleHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadHookOverrides.mockResolvedValue({ shellHooksEnabled: true, enabledById: {} })
    mergeHooksList.mockReturnValue([
      { id: 'h1', event: 'PreToolUse', enabled: true, kind: 'command', origin: 'user' },
      { id: 'h2', event: 'PostToolUse', enabled: true, kind: 'command', origin: 'user' },
    ])
    runHooks.mockResolvedValue({ injectText: '', blocked: false, records: [] })
  })

  it('runs tool after PreToolUse allows', async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = {
      Bash: { description: 'run', execute },
    } as unknown as ToolSet

    const wrapped = wrapToolsWithLifecycleHooks(tools, { sessionId: 's1', workspaceRoot: '/ws' })
    const result = await (wrapped.Bash as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute(
      { cmd: 'ls' },
      {}
    )

    expect(result).toEqual({ ok: true })
    expect(execute).toHaveBeenCalled()
    expect(runHooks).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'PreToolUse', toolName: 'Bash', shellEnabled: true })
    )
    expect(runHooks).toHaveBeenCalledWith(expect.objectContaining({ event: 'PostToolUse', toolName: 'Bash' }))
  })

  it('blocks tool when PreToolUse returns blocked', async () => {
    runHooks.mockResolvedValueOnce({
      injectText: '',
      blocked: true,
      blockReason: 'nope',
      records: [],
    })
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = {
      Bash: { description: 'run', execute },
    } as unknown as ToolSet

    const wrapped = wrapToolsWithLifecycleHooks(tools, {})
    const result = await (wrapped.Bash as { execute: (a: unknown, o: unknown) => Promise<unknown> }).execute({}, {})

    expect(execute).not.toHaveBeenCalled()
    expect(result).toMatchObject({ blocked: true, error: true, message: 'nope' })
  })

  it('leaves tools without execute unchanged', () => {
    const tools = {
      google_search: { description: 'native' },
    } as unknown as ToolSet
    const wrapped = wrapToolsWithLifecycleHooks(tools, {})
    expect(wrapped.google_search).toEqual(tools.google_search)
  })

  it('never runs PostToolUse on client_recall or client_answer results (local-only mail); PreToolUse still runs', async () => {
    const records = { ok: true, records: [{ text: 'The price is 4,200 USD' }], localOnly: true }
    const tools = {
      client_recall: { description: 'recall', execute: vi.fn(async () => records) },
      client_answer: {
        description: 'answer',
        execute: vi.fn(() => Promise.reject(new Error('Jo wrote 4,200 USD'))),
      },
      Bash: { description: 'run', execute: vi.fn(async () => ({ ok: true })) },
    } as unknown as ToolSet
    const wrapped = wrapToolsWithLifecycleHooks(tools, {}) as unknown as Record<
      string,
      { execute: (a: unknown, o: unknown) => Promise<unknown> }
    >

    await expect(wrapped.client_recall.execute({ query: 'price' }, {})).resolves.toEqual(records)
    await expect(wrapped.client_answer.execute({ answer: 'yes' }, {})).rejects.toThrow('Jo wrote')
    const post = () => runHooks.mock.calls.filter(([o]) => (o as { event: string }).event === 'PostToolUse')
    expect(post()).toEqual([])
    expect(runHooks).toHaveBeenCalledWith(expect.objectContaining({ event: 'PreToolUse', toolName: 'client_recall' }))
    expect(runHooks).toHaveBeenCalledWith(expect.objectContaining({ event: 'PreToolUse', toolName: 'client_answer' }))

    await wrapped.Bash.execute({ cmd: 'ls' }, {})
    expect(post().map(([o]) => (o as { toolName: string }).toolName)).toEqual(['Bash'])
  })
})

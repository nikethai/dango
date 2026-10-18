import type { MessageToolCallPart } from '@shared/types'
import { createInstance, type TFunction } from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { liveToolHint, summarizeToolCalls, toolRow } from './tool-summary'

let t: TFunction

beforeAll(async () => {
  const i18n = createInstance()
  await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
  t = i18n.t
})

let nextId = 0
function call(
  toolName: string,
  opts: { state?: MessageToolCallPart['state']; args?: unknown; result?: unknown } = {}
): MessageToolCallPart {
  nextId += 1
  return {
    type: 'tool-call',
    toolCallId: `call-${nextId}`,
    toolName,
    state: opts.state ?? 'result',
    args: opts.args ?? {},
    result: opts.result,
  }
}

describe('summarizeToolCalls', () => {
  it('groups in first-seen order, joined with " · ", first letter upper-cased', () => {
    expect(summarizeToolCalls([call('read_file'), call('query_knowledge_base'), call('read_file')], t)).toBe(
      'Read 2 files · searched scope knowledge'
    )
  })

  it('counts failed calls', () => {
    expect(summarizeToolCalls([call('edit_file', { state: 'error' })], t)).toBe('Staged 1 edit · 1 failed')
  })

  it('leaves task-tracking tools out', () => {
    expect(summarizeToolCalls([call('create_task')], t)).toBe('')
  })

  it('leaves host chrome tools out', () => {
    expect(summarizeToolCalls([call('memory_lookup')], t)).toBe('')
  })

  it('covers every phrase', () => {
    expect(
      summarizeToolCalls(
        [
          call('search_file_content'),
          call('web_search'),
          call('parse_link'),
          call('read_video_url'),
          call('memory_search'),
          call('create_file'),
          call('delete_file'),
          call('terminal'),
          call('browser_click'),
          call('computer_screenshot'),
          call('mystery_tool'),
          call('other_tool'),
        ],
        t
      )
    ).toBe(
      'Searched files · searched the web · opened 2 links · searched scope knowledge · staged 2 edits · ran 1 command · used the browser · used the computer · used 2 tools'
    )
  })
})

describe('toolRow', () => {
  it('reads target and size from the call', () => {
    expect(toolRow(call('read_file', { args: { path: 'docs/a.md' }, result: 'x'.repeat(4100) }), t)).toEqual({
      verb: 'read',
      target: 'docs/a.md',
      size: '4.1k',
    })
  })

  it('counts search hits', () => {
    expect(toolRow(call('web_search', { args: { query: 'dango' }, result: { results: [{}] } }), t).size).toBe('1 hit')
    expect(toolRow(call('search_file_content', { result: [{}, {}] }), t)).toEqual({
      verb: 'search',
      target: 'search_file_content',
      size: '2 hits',
    })
  })

  it('omits size below 1 000 characters and reads result.content', () => {
    expect(toolRow(call('terminal', { args: { command: 'ls' }, result: { content: 'short' } }), t)).toEqual({
      verb: 'run',
      target: 'ls',
    })
    expect(
      toolRow(call('parse_link', { args: { url: 'https://a.b' }, result: { content: 'y'.repeat(1000) } }), t)
    ).toEqual({ verb: 'open', target: 'https://a.b', size: '1k' })
  })

  it('drops a trailing .0 and the decimal at 10k and above', () => {
    const sized = (n: number) => toolRow(call('read_file', { result: 'z'.repeat(n) }), t).size
    expect(sized(4100)).toBe('4.1k')
    expect(sized(2000)).toBe('2k')
    expect(sized(12_345)).toBe('12k')
  })

  it("counts web_search's real searchResults shape", () => {
    const result = { query: 'dango', searchResults: [{}, {}, {}], maxResults: 5 }
    expect(toolRow(call('web_search', { args: { query: 'dango' }, result }), t)).toEqual({
      verb: 'search',
      target: 'dango',
      size: '3 hits',
    })
  })

  it('marks a failed call in the size slot', () => {
    expect(toolRow(call('read_file', { state: 'error', args: { path: 'a.md' }, result: 'x'.repeat(5000) }), t)).toEqual(
      { verb: 'read', target: 'a.md', size: 'failed' }
    )
  })

  it('verbs use their own tool keys, never a bare button label through a context fallback', () => {
    // A context lookup falls back to the bare key in the current locale (de "Bearbeiten", a button label).
    const calls: Array<{ key: string; context?: string }> = []
    const spy = ((key: string, opts?: { context?: string }) => {
      calls.push({ key, context: opts?.context })
      return t(key, opts as never)
    }) as unknown as TFunction
    toolRow(call('edit_file'), spy)
    toolRow(call('read_file'), spy)
    expect(calls.filter((c) => c.key.endsWith('_tool'))).toEqual([{ key: 'edit_tool' }, { key: 'read_tool' }])
    expect(calls.some((c) => c.context)).toBe(false)
    expect((en as Record<string, string>).edit_tool).toBe('edit')
  })
})

describe('liveToolHint', () => {
  it("gives the running call's phrase in lower case", () => {
    expect(liveToolHint([call('read_file'), call('web_search', { state: 'call' })], t)).toBe('searched the web')
  })

  it('is undefined when nothing runs', () => {
    expect(liveToolHint([call('web_search')], t)).toBeUndefined()
    expect(liveToolHint([call('create_task', { state: 'call' })], t)).toBeUndefined()
  })
})

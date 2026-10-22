// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ToolRiskTier } from '@shared/types/mcp'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  describeToolAction,
  getPermissionHead,
  type PermissionRequest,
  requestToolPermission,
  resolvePermission,
} from '@/packages/tool-permission'
import { ToolPermissionHost } from './ToolPermissionHost'
import { ToolPermissionSheet } from './ToolPermissionSheet'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
}))

const HINT = 'Dango always asks before it sends, deletes or changes your files.'
const COMMAND_HINT = 'Dango always asks before it runs commands.'
const READ_ONLY_HINT = '“Always” only skips this question for commands that just look, like this one. Commands that change anything will still ask.'

function makeRequest(over: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    id: 'permission-a',
    sessionId: 's1',
    scopeId: 'scope-1',
    toolName: 'write_note',
    riskTier: ToolRiskTier.MEDIUM,
    summary: { what: 'Edit docs/a.md', why: 'Fix the typo in the intro', touches: ['docs/a.md'] },
    allowAlways: true,
    ...over,
  }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  // Drain the per-window queue so tests stay independent.
  for (let head = getPermissionHead(); head; head = getPermissionHead()) resolvePermission(head.id, 'deny')
  document.body.innerHTML = ''
})

describe('ToolPermissionSheet', () => {
  it('renders the action, the why line and the touched paths', () => {
    render(<ToolPermissionSheet request={makeRequest()} onChoose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Edit docs/a.md' })).toBeTruthy()
    expect(screen.getByText('Fix the typo in the intro')).toBeTruthy()
    expect(screen.getByText('Touches')).toBeTruthy()
    expect(screen.getByText('docs/a.md')).toBeTruthy()
  })

  it('renders nothing without a request', () => {
    render(<ToolPermissionSheet request={null} onChoose={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('first focus is Allow once', () => {
    render(<ToolPermissionSheet request={makeRequest()} onChoose={() => {}} />)
    expect(document.activeElement?.textContent).toBe('Allow once')
  })

  it('Esc is Not now', () => {
    vi.useFakeTimers()
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('deny')
  })

  it('buttons call onChoose with once, always and deny', () => {
    vi.useFakeTimers()
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Always in this scope' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onChoose.mock.calls).toEqual([['once'], ['always'], ['deny']])
  })

  it('first open ignores an immediate click, Enter or scrim click', () => {
    vi.useFakeTimers()
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    // The user was pressing Enter in the composer or clicking Stop as the sheet appeared.
    const allow = screen.getByRole('button', { name: 'Allow once' })
    fireEvent.keyDown(allow, { key: 'Enter' })
    fireEvent.click(allow)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    fireEvent.click(document.querySelector('[aria-hidden="true"]') as Element)
    expect(onChoose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(allow)
    expect(onChoose.mock.calls).toEqual([['once']])
  })

  it('a CRITICAL call that is not always-asks hides Always and shows no hint', () => {
    render(
      <ToolPermissionSheet
        request={makeRequest({
          toolName: 'computer_click',
          riskTier: ToolRiskTier.CRITICAL,
          allowAlways: false,
          summary: { what: 'Use your computer: click', touches: [] },
        })}
        onChoose={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /^Always/ })).toBeNull()
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('scrim click after the guard is Not now', () => {
    vi.useFakeTimers()
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(document.querySelector('[aria-hidden="true"]') as Element)
    expect(onChoose.mock.calls).toEqual([['deny']])
  })

  it('delete hides always and shows the always-asks hint', () => {
    render(
      <ToolPermissionSheet
        request={makeRequest({
          toolName: 'delete_file',
          allowAlways: false,
          summary: { what: 'Delete a.md', touches: [] },
        })}
        onChoose={() => {}}
      />
    )
    expect(screen.queryByRole('button', { name: /^Always/ })).toBeNull()
    expect(screen.getByText(HINT)).toBeTruthy()
    expect(screen.queryByText(COMMAND_HINT)).toBeNull()
  })

  it('run_command shows no Always and the commands hint, even when the caller offered Always', () => {
    void requestToolPermission({
      sessionId: 's1',
      scopeId: 'scope-1',
      toolName: 'run_command',
      riskTier: ToolRiskTier.HIGH,
      summary: { what: 'Run a command', touches: ['ls'] },
      allowAlways: true,
    })
    render(<ToolPermissionSheet request={getPermissionHead()} onChoose={() => {}} />)
    expect(screen.queryByRole('button', { name: /^Always/ })).toBeNull()
    expect(screen.getByText(COMMAND_HINT)).toBeTruthy()
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('a read-only command offers Always in this scope and says other commands still ask', () => {
    void requestToolPermission({
      sessionId: 's1',
      scopeId: 'scope-1',
      toolName: 'mcp__shell__run_command',
      toolDescription: 'Run a shell command',
      riskTier: ToolRiskTier.MEDIUM,
      summary: { what: 'Run a command', touches: ['ls -la'] },
      allowAlways: true,
      readOnlyCommand: true,
    })
    render(<ToolPermissionSheet request={getPermissionHead()} onChoose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Always in this scope' })).toBeTruthy()
    expect(screen.getByText(READ_ONLY_HINT)).toBeTruthy()
    expect(screen.queryByText(COMMAND_HINT)).toBeNull()
  })

  it('a tool described as running shell commands shows the commands hint', () => {
    render(
      <ToolPermissionSheet
        request={makeRequest({ toolName: 'mcp_tool', toolDescription: 'Run a shell command', allowAlways: false })}
        onChoose={() => {}}
      />
    )
    expect(screen.getByText(COMMAND_HINT)).toBeTruthy()
  })

  it('rm -rf ~ shows what Dango says the command does, before the why line', () => {
    const summary = describeToolAction('run_command', { command: 'rm -rf ~', reason: 'Clean up' })
    render(
      <ToolPermissionSheet
        request={makeRequest({ toolName: 'run_command', summary, allowAlways: false })}
        onChoose={() => {}}
      />
    )
    const heading = screen.getByText('What this does')
    const line = screen.getByText('Deletes your home folder and everything inside it.')
    expect(screen.getByText('Skips the confirmation prompts.')).toBeTruthy()
    const why = screen.getByText('Clean up')
    expect(heading.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(line.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('rm -rf ~')).toBeTruthy()
  })

  it('ls -la shows no "What this does"', () => {
    const summary = describeToolAction('run_command', { command: 'ls -la' })
    render(<ToolPermissionSheet request={makeRequest({ toolName: 'run_command', summary })} onChoose={() => {}} />)
    expect(screen.queryByText('What this does')).toBeNull()
  })

  it('a target from the command renders as text, not markup', () => {
    const summary = describeToolAction('run_command', { command: 'rm -r <b>boom</b>' })
    const { container } = render(
      <ToolPermissionSheet request={makeRequest({ toolName: 'run_command', summary })} onChoose={() => {}} />
    )
    expect(screen.getByText('Deletes <b>boom</b> and everything inside it.')).toBeTruthy()
    expect(document.querySelector('b')).toBeNull()
    expect(container).toBeTruthy()
  })

  it('no hint when Always is offered', () => {
    render(<ToolPermissionSheet request={makeRequest()} onChoose={() => {}} />)
    expect(screen.queryByText(HINT)).toBeNull()
  })

  it('unscoped chat offers Always in this chat', () => {
    render(<ToolPermissionSheet request={makeRequest({ scopeId: undefined })} onChoose={() => {}} />)
    expect(screen.getByRole('button', { name: 'Always in this chat' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Always in this scope' })).toBeNull()
  })

  it('seven touches show five paths and "and 2 more"', () => {
    const touches = Array.from({ length: 7 }, (_, i) => `src/file-${i}.ts`)
    render(
      <ToolPermissionSheet request={makeRequest({ summary: { what: 'Edit 7 files', touches } })} onChoose={() => {}} />
    )
    for (const path of touches.slice(0, 5)) expect(screen.getByText(path)).toBeTruthy()
    expect(screen.queryByText('src/file-5.ts')).toBeNull()
    expect(screen.queryByText('src/file-6.ts')).toBeNull()
    expect(screen.getByText('and 2 more')).toBeTruthy()
  })

  it('no touches: no Touches label', () => {
    render(
      <ToolPermissionSheet
        request={makeRequest({ summary: { what: 'Use the browser', touches: [] } })}
        onChoose={() => {}}
      />
    )
    expect(screen.queryByText('Touches')).toBeNull()
  })

  it('a long path is truncated visually and keeps its full text', () => {
    const long = `docs/${'deep/'.repeat(40)}a.md`
    render(
      <ToolPermissionSheet
        request={makeRequest({ summary: { what: 'Edit a.md', touches: [long] } })}
        onChoose={() => {}}
      />
    )
    const item = screen.getByText(long)
    expect(item.style.textOverflow).toBe('ellipsis')
    expect(item.style.whiteSpace).toBe('nowrap')
    expect(item.getAttribute('title')).toBe(long)
  })

  it('external text is plain text, not markup', () => {
    const what = 'Edit <b>x</b>.md'
    render(
      <ToolPermissionSheet
        request={makeRequest({ summary: { what, why: '<i>why</i>', touches: ['<u>t</u>'] } })}
        onChoose={() => {}}
      />
    )
    expect(screen.getByRole('dialog', { name: what })).toBeTruthy()
    expect(screen.getByText('<i>why</i>')).toBeTruthy()
    expect(screen.getByText('<u>t</u>')).toBeTruthy()
    expect(document.querySelector('b, i, u')).toBeNull()
  })

  it('a new head refocuses Allow once and ignores clicks for a moment', () => {
    vi.useFakeTimers()
    const onChoose = vi.fn()
    const { rerender } = render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    const next = makeRequest({ id: 'permission-b', summary: { what: 'Edit docs/b.md', touches: ['docs/b.md'] } })
    rerender(<ToolPermissionSheet request={next} onChoose={onChoose} />)
    ;(screen.getByRole('button', { name: 'Not now' }) as HTMLElement).focus()
    rerender(<ToolPermissionSheet request={{ ...next, id: 'permission-c' }} onChoose={onChoose} />)
    expect(document.activeElement?.textContent).toBe('Allow once')

    // A second click of a double-click lands on the new sheet: ignored.
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Always in this scope' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onChoose).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(onChoose).toHaveBeenCalledWith('once')
  })

  it('the permission UI uses only the Sheet component and no Trans', () => {
    for (const file of ['ToolPermissionSheet.tsx', 'ToolPermissionHost.tsx']) {
      const source = readFileSync(resolve(__dirname, file), 'utf8')
      expect(source).not.toContain(['dg', 'sheet'].join('-'))
      expect(source).not.toContain('<Trans')
    }
  })
})

describe('ToolPermissionHost', () => {
  const base = {
    sessionId: 's1',
    scopeId: 'scope-1',
    toolName: 'write_note',
    riskTier: ToolRiskTier.MEDIUM,
    allowAlways: true,
  }

  it('shows queued requests one at a time, in order', async () => {
    vi.useFakeTimers()
    render(<ToolPermissionHost />)
    let first: Promise<string> | undefined
    let second: Promise<string> | undefined
    act(() => {
      first = requestToolPermission({ ...base, summary: { what: 'Edit docs/a.md', touches: ['docs/a.md'] } })
      second = requestToolPermission({
        ...base,
        toolName: 'other_tool',
        summary: { what: 'Edit docs/b.md', touches: [] },
      })
    })
    expect(screen.getByRole('dialog', { name: 'Edit docs/a.md' })).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    })
    await expect(first).resolves.toBe('once')
    expect(screen.getByRole('dialog', { name: 'Edit docs/b.md' })).toBeTruthy()

    // The double-click guard: the next sheet ignores an immediate click.
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    })
    expect(getPermissionHead()?.summary.what).toBe('Edit docs/b.md')

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    })
    await expect(second).resolves.toBe('deny')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('aborting the head closes the sheet and shows the next request', async () => {
    render(<ToolPermissionHost />)
    const controller = new AbortController()
    let first: Promise<string> | undefined
    act(() => {
      first = requestToolPermission(
        { ...base, summary: { what: 'Edit docs/a.md', touches: [] } },
        { signal: controller.signal }
      )
      void requestToolPermission({ ...base, toolName: 'other_tool', summary: { what: 'Edit docs/b.md', touches: [] } })
    })
    expect(screen.getByRole('dialog', { name: 'Edit docs/a.md' })).toBeTruthy()
    act(() => controller.abort())
    await expect(first).resolves.toBe('deny')
    expect(screen.getByRole('dialog', { name: 'Edit docs/b.md' })).toBeTruthy()
  })

  it('aborting the only request closes the sheet', () => {
    render(<ToolPermissionHost />)
    const controller = new AbortController()
    act(() => {
      void requestToolPermission(
        { ...base, summary: { what: 'Edit docs/a.md', touches: [] } },
        { signal: controller.signal }
      )
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    act(() => controller.abort())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('the 120 s timeout closes the open sheet as Not now', async () => {
    vi.useFakeTimers()
    render(<ToolPermissionHost />)
    let first: Promise<string> | undefined
    act(() => {
      first = requestToolPermission({ ...base, summary: { what: 'Edit docs/a.md', touches: [] } })
    })
    act(() => {
      vi.advanceTimersByTime(120_000)
    })
    await expect(first).resolves.toBe('deny')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

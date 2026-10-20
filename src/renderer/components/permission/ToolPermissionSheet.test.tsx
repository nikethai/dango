// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ToolRiskTier } from '@shared/types/mcp'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
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
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onChoose).toHaveBeenCalledTimes(1)
    expect(onChoose).toHaveBeenCalledWith('deny')
  })

  it('buttons call onChoose with once, always and deny', () => {
    const onChoose = vi.fn()
    render(<ToolPermissionSheet request={makeRequest()} onChoose={onChoose} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    fireEvent.click(screen.getByRole('button', { name: 'Always in this scope' }))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(onChoose.mock.calls).toEqual([['once'], ['always'], ['deny']])
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

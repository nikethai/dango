import { ToolRiskTier } from '@shared/types/mcp'
import { describe, expect, it, vi } from 'vitest'
import { alwaysAsks, canAlways, describeToolAction, toolLabel } from './describe'

vi.mock('i18next', () => ({
  t: (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(opts?.[name] ?? '')),
}))

describe('describeToolAction', () => {
  it('edit_file names the path it edits', () => {
    expect(describeToolAction('edit_file', { path: 'docs/a.md' })).toEqual({
      what: 'Edit docs/a.md',
      touches: ['docs/a.md'],
    })
  })

  it('apply_workspace_changes with two changes reads as two files', () => {
    const summary = describeToolAction('apply_workspace_changes', { changes: [{ path: 'a' }, { path: 'b' }] })
    expect(summary.what).toBe('Edit 2 files')
    expect(summary.touches).toEqual(['a', 'b'])
  })

  it('browser_navigate opens the host', () => {
    const summary = describeToolAction('browser_navigate', { url: 'https://github.com/x' })
    expect(summary.what).toBe('Open github.com')
    expect(summary.touches).toEqual(['github.com'])
  })

  it('computer_click names the action', () => {
    expect(describeToolAction('computer_click', {}).what).toBe('Use your computer: click')
  })

  it('run_local_code takes why from reason and cuts the command to 80 chars', () => {
    const summary = describeToolAction('run_local_code', { command: 'x'.repeat(200), reason: 'Run the tests' })
    expect(summary.what).toBe('Run a command')
    expect(summary.why).toBe('Run the tests')
    expect(summary.touches[0]).toHaveLength(80)
  })

  it('send-like MCP tools read as sending a message', () => {
    expect(describeToolAction('mcp_gmail_send_email', { to: 'a@b.c' })).toEqual({
      what: 'Send a message',
      touches: ['a@b.c'],
    })
  })

  it('other browser tools name the host, or just the browser', () => {
    expect(describeToolAction('browser_click', { url: 'https://example.com/p' }).what).toBe(
      'Use the browser on example.com'
    )
    expect(describeToolAction('browser_click', {}).what).toBe('Use the browser')
  })

  it('delete_file names the path; shell-like names run a command; others use the label', () => {
    expect(describeToolAction('delete_file', { path: 'a.txt' }).what).toBe('Delete a.txt')
    expect(describeToolAction('mcp_terminal_run', {}).what).toBe('Run a command')
    expect(describeToolAction('web_search', { query: 'x' }).what).toBe('Use Web search')
  })

  it('why falls back to the first sentence of the description, capped at 140 chars', () => {
    expect(describeToolAction('web_search', {}, 'Search the web. Returns links.').why).toBe('Search the web.')
    expect(describeToolAction('web_search', {}, 'y'.repeat(300)).why?.length).toBeLessThanOrEqual(140)
    expect(describeToolAction('web_search', {}).why).toBeUndefined()
    expect(describeToolAction('web_search', { reason: '  ', purpose: 'Find docs' }).why).toBe('Find docs')
  })

  it('touches collects paths, url host, command and recipients, deduplicated in order', () => {
    const summary = describeToolAction('mcp_mail_send', {
      path: 'a',
      file_path: 'a',
      paths: ['b', 'c'],
      changes: [{ path: 'c' }, { path: 'd' }],
      url: 'https://h.example/x',
      command: 'ls',
      to: ['p@q.r'],
      recipient: 's@t.u',
    })
    expect(summary.touches).toEqual(['a', 'b', 'c', 'd', 'h.example', 'ls', 'p@q.r', 's@t.u'])
  })

  it('never puts file content into the summary', () => {
    const summary = describeToolAction('edit_file', { path: 'a.ts', content: 'SECRET', new_string: 'SECRET' })
    expect(JSON.stringify(summary)).not.toContain('SECRET')
  })

  it('tolerates args that are not objects', () => {
    expect(describeToolAction('web_search', null)).toEqual({ what: 'Use Web search', touches: [] })
  })
})

describe('alwaysAsks / canAlways / toolLabel', () => {
  it('always asks for sensitive, send, delete and pay tools', () => {
    expect(alwaysAsks('delete_file')).toBe(true)
    expect(alwaysAsks('gmail_send')).toBe(true)
    expect(alwaysAsks('stripe_pay')).toBe(true)
    expect(alwaysAsks('edit_file')).toBe(true)
    expect(alwaysAsks('browser_click')).toBe(false)
    expect(alwaysAsks('web_search')).toBe(false)
  })

  it('offers Always unless the tool always asks or is critical', () => {
    expect(canAlways('browser_click', ToolRiskTier.HIGH)).toBe(true)
    expect(canAlways('browser_click', ToolRiskTier.CRITICAL)).toBe(false)
    expect(canAlways('delete_file', ToolRiskTier.LOW)).toBe(false)
  })

  it('labels tool names in sentence case', () => {
    expect(toolLabel('browser_click')).toBe('Browser click')
  })
})

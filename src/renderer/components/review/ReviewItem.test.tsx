/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import postcss, { type Rule } from 'postcss'
import { describe, expect, it, vi } from 'vitest'
import { ReviewItem } from './ReviewItem'

const SOURCE = 'docs/specs/2026-10-16-redesign-brief.md'

const componentsCss = postcss.parse(
  readFileSync(resolve(process.cwd(), 'src/renderer/static/dango-components.css'), 'utf8')
)

const declarationsOf = (selector: string) => {
  const found: Record<string, string> = {}
  componentsCss.walkRules((rule: Rule) => {
    if (rule.selector === selector) {
      rule.walkDecls((decl) => {
        found[decl.prop] = decl.value
      })
    }
  })
  return found
}

describe('ReviewItem', () => {
  it('renders a disabled action as a disabled button', () => {
    render(
      <ReviewItem
        kind="proposal"
        scope="Acme Co"
        text="Item"
        actions={[{ label: 'Approve', onClick: () => {}, disabled: true }]}
      />
    )
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('renders the kind label, scope and text, and marks needs-you items', () => {
    const { container } = render(
      <ReviewItem kind="needs-you" scope="Acme Co" text="Which quote is current?" actions={[]} />
    )
    expect(screen.getByText('Needs you · Acme Co')).toBeTruthy()
    expect(screen.getByText('Which quote is current?')).toBeTruthy()
    expect(container.firstElementChild?.classList.contains('dg-item--needs')).toBe(true)
  })

  it('maps the other kinds to their modifier classes', () => {
    const cases: Array<[Parameters<typeof ReviewItem>[0]['kind'], string | null]> = [
      ['done', 'dg-item--done'],
      ['conflict', 'dg-item--conflict'],
      ['proposal', null],
      ['change', null],
      ['re-check', null],
    ]
    for (const [kind, modifier] of cases) {
      const { container, unmount } = render(<ReviewItem kind={kind} scope="Acme Co" text="Item" actions={[]} />)
      const classes = Array.from(container.firstElementChild?.classList ?? []).filter((c) => c.startsWith('dg-item--'))
      expect(classes).toEqual(modifier ? [modifier] : [])
      unmount()
    }
  })

  it('shows the source in the meta line and the stylesheet keeps long paths inside the column', () => {
    const { container } = render(
      <ReviewItem kind="proposal" scope="Acme Co" source={SOURCE} text="Update the brief" actions={[]} />
    )
    const meta = container.querySelector('.dg-item__meta')
    expect(meta?.textContent).toBe(`Proposal · Acme Co · ${SOURCE}`)

    const declarations = { ...declarationsOf('.dg-item__meta'), ...declarationsOf('.dg-item__text') }
    expect(declarations['min-width']).toBe('0')
    expect(declarations['overflow-wrap']).toBe('anywhere')
  })

  it('renders at most three actions, styles the primary one and wires clicks', () => {
    const onApprove = vi.fn()
    render(
      <ReviewItem
        kind="proposal"
        scope="Acme Co"
        text="Update the brief"
        actions={[
          { label: 'Approve', onClick: onApprove, variant: 'primary' },
          { label: 'Edit', onClick: vi.fn() },
          { label: 'Dismiss', onClick: vi.fn(), variant: 'ghost' },
          { label: 'Fourth', onClick: vi.fn() },
        ]}
      />
    )
    expect(screen.getAllByRole('button')).toHaveLength(3)
    expect(screen.queryByText('Fourth')).toBeNull()
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve.className).toContain('dg-btn--primary')
    expect(screen.getByRole('button', { name: 'Dismiss' }).className).toContain('dg-btn--ghost')
    expect(screen.getByRole('button', { name: 'Edit' }).className).not.toContain('--')
    fireEvent.click(approve)
    expect(onApprove).toHaveBeenCalledTimes(1)
  })

  it('adds is-focused and labels the article with the meta line and text', () => {
    render(
      <ReviewItem kind="done" scope="Acme Co" text="Sent the invoice" sub="2 files changed" actions={[]} focused />
    )
    const article = screen.getByRole('article')
    expect(article.tagName).toBe('ARTICLE')
    expect(article.classList.contains('is-focused')).toBe(true)
    expect(article.getAttribute('aria-label')).toBe('Done · Acme Co. Sent the invoice')
    expect(screen.getByText('2 files changed')).toBeTruthy()
  })
})

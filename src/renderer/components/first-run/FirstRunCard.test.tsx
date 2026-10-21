// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/components/brand/Mascot', () => ({
  Mascot: ({ state, size }: { state: string; size: number }) => (
    <svg data-testid="mascot" data-state={state} width={size} />
  ),
}))

import { FirstRunCard } from './FirstRunCard'

afterEach(cleanup)

describe('FirstRunCard', () => {
  it('renders the title as h1, the lead, the body and the footer', () => {
    render(
      <FirstRunCard
        step={2}
        title="Connect a source"
        lead="A lead line."
        footer={<button type="button">Continue</button>}
      >
        <p>Body</p>
      </FirstRunCard>
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Connect a source' })).toBeTruthy()
    expect(screen.getByText('A lead line.')).toBeTruthy()
    expect(screen.getByText('Body')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
  })

  it('shows an idle 40 px mascot and five dots filled up to the current step', () => {
    const { container } = render(
      <FirstRunCard step={3} title="Name this scope" footer={null}>
        {null}
      </FirstRunCard>
    )
    const mascot = screen.getByTestId('mascot')
    expect(mascot.getAttribute('data-state')).toBe('idle')
    expect(mascot.getAttribute('width')).toBe('40')
    expect(mascot.closest('[aria-hidden="true"]')).toBeTruthy()
    const progress = screen.getByLabelText('Step 3 of 5')
    const dots = progress.querySelectorAll('.dg-first-run__dot')
    expect(dots).toHaveLength(5)
    expect(Array.from(dots).map((d) => d.classList.contains('is-done'))).toEqual([true, true, true, false, false])
    expect(container.querySelector('section.dg-first-run__card')).toBeTruthy()
  })

  it('omits the lead when none is given', () => {
    const { container } = render(
      <FirstRunCard step={1} title="Sign in to a model" footer={null}>
        {null}
      </FirstRunCard>
    )
    expect(container.querySelector('.dg-first-run__lead')).toBeNull()
  })
})

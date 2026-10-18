/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { CostWarningRow, normalizeCostWarning } from './CostWarningRow'
import { ShowThinkingRow } from './ShowThinkingRow'

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const wrap = (node: React.ReactNode) => render(<MantineProvider>{node}</MantineProvider>)

describe('normalizeCostWarning', () => {
  it('keeps previous for empty, junk and NaN', () => {
    expect(normalizeCostWarning('', 0.5)).toBe(0.5)
    expect(normalizeCostWarning('abc', 0.5)).toBe(0.5)
    expect(normalizeCostWarning(Number.NaN, 0.5)).toBe(0.5)
  })
  it('clamps negatives to 0, keeps 0, rounds to cents', () => {
    expect(normalizeCostWarning('-2', 0.5)).toBe(0)
    expect(normalizeCostWarning('0', 0.5)).toBe(0)
    expect(normalizeCostWarning('1.239', 0.5)).toBe(1.24)
  })
})

describe('CostWarningRow', () => {
  const field = () => screen.getByLabelText('Cost limit in US dollars') as HTMLInputElement

  it('commits on blur and Enter, and resets an empty draft', () => {
    const onChange = vi.fn()
    wrap(<CostWarningRow value={0.5} onChange={onChange} />)
    expect(field().value).toBe('$0.5')

    fireEvent.change(field(), { target: { value: '2' } })
    fireEvent.blur(field())
    expect(onChange).toHaveBeenCalledWith(2)

    onChange.mockClear()
    fireEvent.change(field(), { target: { value: '' } })
    fireEvent.blur(field())
    expect(onChange).not.toHaveBeenCalled()
    expect(field().value).toBe('$0.5')

    fireEvent.change(field(), { target: { value: '0' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})

describe('ShowThinkingRow', () => {
  it('reports the chosen option', () => {
    const onChange = vi.fn()
    wrap(<ShowThinkingRow value="auto" onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Closed'))
    expect(onChange).toHaveBeenCalledWith('closed')
  })
})

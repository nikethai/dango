// @vitest-environment jsdom
// A11Y1 rule 2 (slice 09 Task 10 fix round): with reduced motion, Mantine's Collapse still opens and closes; it just
// skips the height transition (and so never waits for transitionend).
import { Collapse, MantineProvider } from '@mantine/core'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from './mantineTheme'

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media === '(prefers-reduced-motion: reduce)' ? matches : false,
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Panel({ opened }: { opened: boolean }) {
  return (
    <MantineProvider theme={createDangoMantineTheme()}>
      <Collapse in={opened}>
        <p>Panel body</p>
      </Collapse>
    </MantineProvider>
  )
}

describe('Mantine Collapse under reduced motion', () => {
  it('opens and closes at once, with no transition left on the content', async () => {
    stubReducedMotion(true)
    const { rerender } = render(<Panel opened={false} />)
    rerender(<Panel opened />)
    await waitFor(() => expect(screen.getByText('Panel body')).toBeTruthy())
    const wrapper = screen.getByText('Panel body').parentElement as HTMLElement
    await waitFor(() => expect(wrapper.style.transition).toBe(''))
    expect(wrapper.style.height).toBe('')
    rerender(<Panel opened={false} />)
    await waitFor(() => expect(screen.queryByText('Panel body')).toBeNull())
  })
})

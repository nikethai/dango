/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { render, screen, waitFor } from '@testing-library/react'
import { vi } from 'vitest'
import { AdaptiveModal } from './AdaptiveModal'

const { useIsSmallScreen } = vi.hoisted(() => ({
  useIsSmallScreen: vi.fn(),
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    addEventListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
  }),
})

vi.mock('@/hooks/useScreenChange', () => ({
  useIsSmallScreen,
}))

function renderActions() {
  render(
    <MantineProvider>
      <AdaptiveModal.Actions>
        <button type="button">Cancel</button>
        <button type="button">Save</button>
      </AdaptiveModal.Actions>
    </MantineProvider>
  )

  return screen.getByRole('button', { name: 'Save' }).parentElement
}

type MobileModalProps =
  | { title: string; ariaLabel?: never; description?: React.ReactNode }
  | { title: React.ReactElement; ariaLabel: string; description?: React.ReactNode }
  | { title?: undefined; ariaLabel: string; description?: React.ReactNode }

function renderMobileModal(props: MobileModalProps) {
  useIsSmallScreen.mockReturnValue(true)

  const body = <button type="button">Save</button>

  if (typeof props.title === 'string') {
    render(
      <MantineProvider>
        <AdaptiveModal opened onClose={vi.fn()} title={props.title} description={props.description}>
          {body}
        </AdaptiveModal>
      </MantineProvider>
    )
    return
  }

  if (props.title !== undefined) {
    render(
      <MantineProvider>
        <AdaptiveModal
          opened
          onClose={vi.fn()}
          title={props.title}
          ariaLabel={props.ariaLabel}
          description={props.description}
        >
          {body}
        </AdaptiveModal>
      </MantineProvider>
    )
    return
  }

  render(
    <MantineProvider>
      <AdaptiveModal opened onClose={vi.fn()} ariaLabel={props.ariaLabel} description={props.description}>
        {body}
      </AdaptiveModal>
    </MantineProvider>
  )
}

describe('AdaptiveModal.Actions', () => {
  it('uses the unframed reversed stack for multiple mobile actions', () => {
    useIsSmallScreen.mockReturnValue(true)

    const actions = renderActions()

    expect(actions).not.toBeNull()
    expect(actions?.classList.contains('flex-col-reverse')).toBe(true)
    expect(actions?.classList.contains('mantine-Stack-root')).toBe(true)
    expect(actions?.classList.contains('border-t')).toBe(false)
  })

  it('keeps the desktop Flex action layout', () => {
    useIsSmallScreen.mockReturnValue(false)

    const actions = renderActions()

    expect(actions).not.toBeNull()
    expect(actions?.classList.contains('mantine-Flex-root')).toBe(true)
    expect(actions?.classList.contains('flex-col-reverse')).toBe(false)
    expect(actions?.classList.contains('border-t')).toBe(false)
  })
})

describe('AdaptiveModal mobile dialog semantics', () => {
  it('uses a string title as the Vaul dialog name without inventing a description', () => {
    renderMobileModal({ title: 'Add provider' })

    const dialog = screen.getByRole('dialog', { name: 'Add provider' })
    const title = screen.getByText('Add provider')

    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.getAttribute('aria-describedby')).toBeNull()
    expect(screen.getAllByText('Add provider')).toHaveLength(1)
  })

  it('uses an explicitly supplied description to describe the Vaul dialog', () => {
    renderMobileModal({ description: 'Choose a name and API mode for this provider.', title: 'Add provider' })

    const dialog = screen.getByRole('dialog', { name: 'Add provider' })
    const description = screen.getByText('Choose a name and API mode for this provider.')

    expect(dialog.getAttribute('aria-describedby')).toBe(description.id)
    expect(description.classList.contains('sr-only')).toBe(true)
  })

  it('keeps a React title node visual-only and uses its explicit accessible label', () => {
    renderMobileModal({ ariaLabel: 'Edit Model', title: <span className="custom-title">Edit Model</span> })

    const dialog = screen.getByRole('dialog', { name: 'Edit Model' })
    const title = screen.getByText('Edit Model', { selector: '.custom-title' })

    expect(dialog.getAttribute('aria-labelledby')).not.toBeNull()
    expect(title.classList.contains('custom-title')).toBe(true)
    expect(dialog.getAttribute('aria-describedby')).toBeNull()
  })

  it('uses an explicit accessible label when no visible title is supplied', () => {
    renderMobileModal({ ariaLabel: 'Welcome to Dango' })

    const dialog = screen.getByRole('dialog', { name: 'Welcome to Dango' })
    const title = screen.getByText('Welcome to Dango')

    expect(title.classList.contains('sr-only')).toBe(true)
    expect(dialog.getAttribute('aria-labelledby')).toBe(title.id)
    expect(dialog.getAttribute('aria-describedby')).toBeNull()
  })

  it('moves focus into the sheet on open so Tab stays trapped inside it', async () => {
    renderMobileModal({ ariaLabel: 'Welcome to Dango' })

    const dialog = screen.getByRole('dialog', { name: 'Welcome to Dango' })

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true))
  })
})

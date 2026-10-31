/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ getSourceControlStatus: vi.fn() }))

vi.mock('@/platform', () => ({ default: { getSourceControlStatus: m.getSourceControlStatus } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { SourceControlView } from './SourceControlView'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('SourceControlView errors', () => {
  it('says Source Control is not available yet when the feature is off, never the error code', async () => {
    m.getSourceControlStatus.mockRejectedValue(new Error('FEATURE_DISABLED: scm is disabled'))
    render(<SourceControlView capabilityId="cap-1" />)
    expect(await screen.findByText("Source Control isn't available yet.")).toBeTruthy()
    expect(document.body.textContent).not.toContain('FEATURE_DISABLED')
  })

  it('shows a plain sentence for other workspace errors', async () => {
    m.getSourceControlStatus.mockRejectedValue(new Error('SCM_TIMEOUT: git status took too long'))
    render(<SourceControlView capabilityId="cap-1" />)
    expect(await screen.findByText("Couldn't load Source Control. Try again later.")).toBeTruthy()
    expect(document.body.textContent).not.toContain('SCM_TIMEOUT')
  })
})

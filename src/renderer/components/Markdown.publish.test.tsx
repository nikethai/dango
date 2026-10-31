/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { show, deploy } = vi.hoisted(() => ({ show: vi.fn(), deploy: vi.fn() }))

vi.mock('@ebay/nice-modal-react', () => ({ default: { show } }))
vi.mock('../packages/edgeone', () => ({ deployHtmlToEdgeOne: deploy }))
vi.mock('@/platform', () => ({
  default: { openLink: vi.fn() },
  platformCapabilities: { isMobileLayout: false },
}))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

import Markdown, { BlockCodeCollapsedStateProvider, CodePublishContext } from './Markdown'

const HTML = '<h1>Hi</h1>'
const content = `\`\`\`html\n${HTML}\n\`\`\``

function renderBlock(publishAllowed?: boolean) {
  const markdown = <Markdown uniqueId="m1-0">{content}</Markdown>
  return render(
    <MantineProvider>
      <BlockCodeCollapsedStateProvider defaultCollapsed={false}>
        {publishAllowed === undefined ? (
          markdown
        ) : (
          <CodePublishContext.Provider value={publishAllowed}>{markdown}</CodePublishContext.Provider>
        )}
      </BlockCodeCollapsedStateProvider>
    </MantineProvider>
  )
}

beforeEach(() => {
  show.mockReset()
  deploy.mockReset()
  deploy.mockResolvedValue('https://example.edgeone.app/x')
})
afterEach(cleanup)

describe('Publish Webpage on an HTML code block', () => {
  it('asks before uploading, and uploads nothing when the user cancels', async () => {
    show.mockResolvedValueOnce(false)
    renderBlock()
    fireEvent.click(screen.getByRole('button', { name: 'Publish Webpage' }))
    await waitFor(() => expect(show).toHaveBeenCalledWith('publish-webpage-confirm'))
    await Promise.resolve()
    expect(deploy).not.toHaveBeenCalled()
  })

  it('uploads only after the user confirms', async () => {
    show.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined)
    renderBlock()
    fireEvent.click(screen.getByRole('button', { name: 'Publish Webpage' }))
    await waitFor(() => expect(deploy).toHaveBeenCalledTimes(1))
    expect(deploy.mock.calls[0][0].trim()).toBe(HTML)
    expect(show.mock.calls[0][0]).toBe('publish-webpage-confirm')
  })

  it('is not offered in a chat that holds device-only text', () => {
    renderBlock(false)
    expect(screen.queryByRole('button', { name: 'Publish Webpage' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open as Artifact' })).toBeTruthy()
  })
})

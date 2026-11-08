/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { ConfigModal } from './ConfigModal'

const { serverState } = vi.hoisted(() => ({
  serverState: { fail: false },
}))

vi.mock('@/packages/mcp/controller', () => ({
  MCPServer: class {
    status = { state: 'running' }
    start() {
      return serverState.fail ? Promise.reject(new Error('connect ECONNREFUSED')) : Promise.resolve()
    }
    getAvailableTools() {
      return Promise.resolve({ read_file: { description: 'Read a file' } })
    }
    stop() {
      return Promise.resolve()
    }
  },
}))

vi.mock('@/utils/track', () => ({ trackEvent: vi.fn() }))

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    addEventListener: vi.fn(),
    addListener: vi.fn(),
    matches: false,
    removeEventListener: vi.fn(),
    removeListener: vi.fn(),
  }),
})

const config: MCPServerConfig = {
  id: 'srv-1',
  name: 'Example',
  enabled: true,
  transport: { type: 'http', url: 'https://example.com/mcp' },
}

function renderModal() {
  render(
    <MantineProvider>
      <ConfigModal mode="add" config={config} onClose={vi.fn()} onSave={vi.fn()} onDelete={vi.fn()} />
    </MantineProvider>
  )
}

// Save is a real submit button only once the test passed; before that it is the disabled stand-in.
const saveButton = () => screen.getByRole('button', { name: 'Save' })
const isLocked = () => saveButton().hasAttribute('data-disabled')

describe('MCP ConfigModal Save gate', () => {
  beforeEach(() => {
    serverState.fail = false
  })

  it('keeps Save locked before any test', async () => {
    renderModal()
    await screen.findByRole('dialog')
    expect(isLocked()).toBe(true)
  })

  it('keeps Save locked after a failed test', async () => {
    serverState.fail = true
    renderModal()
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))

    await screen.findByText('connect ECONNREFUSED')
    expect(isLocked()).toBe(true)
  })

  it('unlocks Save after a successful test', async () => {
    renderModal()
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: 'Test' }))

    await screen.findByText('read_file')
    await waitFor(() => expect(isLocked()).toBe(false))
  })
})

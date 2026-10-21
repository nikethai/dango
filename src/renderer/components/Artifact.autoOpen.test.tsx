// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import type { MessageArtifact as MessageArtifactRecord } from '@shared/types/session'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uiStore } from '@/stores/uiStore'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { MessageArtifact } from './Artifact'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/stores/sessionActions', () => ({ getMessageThreadContext: vi.fn(async () => []) }))
vi.mock('./Markdown', () => ({ default: () => null }))
vi.mock('./Mermaid', () => ({ MessageMermaid: () => null }))
vi.mock('./workspace/HtmlWorkspaceView', () => ({ HtmlWorkspaceView: () => null }))
vi.mock('./workspace/WorkspaceCodeView', () => ({ WorkspaceCodeView: () => null }))

const HTML_A = '<main><h1>Pricing table</h1><p>Plans</p></main>'
const HTML_B = `${HTML_A}<footer>More rows streamed in</footer>`

function artifactOf(content: string): MessageArtifactRecord {
  return {
    id: `art-${content.length}`,
    type: 'html',
    title: 'Pricing table',
    content,
    version: 1,
  } as MessageArtifactRecord
}

let messageCounter = 0

function view(props: { messageId: string; content: string; generating: boolean }) {
  return (
    <MantineProvider theme={createDangoMantineTheme()}>
      <MessageArtifact
        sessionId="s1"
        messageId={props.messageId}
        messageContent=""
        preview={false}
        setPreview={() => {}}
        autoOpenWorkspace
        generating={props.generating}
        artifact={artifactOf(props.content)}
      />
    </MantineProvider>
  )
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

beforeEach(() => {
  messageCounter += 1
  uiStore.setState({ workspacePanel: null, workspaceExpanded: false })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('artifact auto-open (slice 9: never a sheet on its own)', () => {
  it.each([
    ['medium', 1000],
    ['phone', 390],
  ])('%s: a streaming artifact never opens the inspector', async (_name, width) => {
    setWindowWidth(width)
    const id = `m${messageCounter}`
    const { rerender } = render(view({ messageId: id, content: HTML_A, generating: true }))
    await act(async () => {})
    rerender(view({ messageId: id, content: HTML_B, generating: true }))
    rerender(view({ messageId: id, content: HTML_B, generating: false }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel).toBeNull()
  })

  it('wide: opens once while streaming and keeps the open pane in step', async () => {
    setWindowWidth(1280)
    const id = `m${messageCounter}`
    const { rerender } = render(view({ messageId: id, content: HTML_A, generating: true }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel?.messageId).toBe(id)
    expect(uiStore.getState().workspacePanel?.content).toBe(HTML_A)
    rerender(view({ messageId: id, content: HTML_B, generating: true }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel?.content).toBe(HTML_B)
  })

  it('wide: once closed, later tokens and the end of the reply do not reopen it', async () => {
    setWindowWidth(1280)
    const id = `m${messageCounter}`
    const { rerender } = render(view({ messageId: id, content: HTML_A, generating: true }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel).not.toBeNull()
    act(() => uiStore.getState().setWorkspacePanel(null))
    rerender(view({ messageId: id, content: HTML_B, generating: true }))
    rerender(view({ messageId: id, content: HTML_B, generating: false }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel).toBeNull()
  })

  it('wide: re-mounting the message (scrolled back into view) does not reopen it', async () => {
    setWindowWidth(1280)
    const id = `m${messageCounter}`
    const first = render(view({ messageId: id, content: HTML_A, generating: true }))
    await act(async () => {})
    act(() => uiStore.getState().setWorkspacePanel(null))
    first.unmount()
    render(view({ messageId: id, content: HTML_B, generating: true }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel).toBeNull()
  })

  it('wide: a finished message from history does not open on mount', async () => {
    setWindowWidth(1280)
    render(view({ messageId: `m${messageCounter}`, content: HTML_B, generating: false }))
    await act(async () => {})
    expect(uiStore.getState().workspacePanel).toBeNull()
  })
})

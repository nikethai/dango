import { beforeEach, describe, expect, it, vi } from 'vitest'
import { settings as getDefaultSettings } from '@shared/defaults'
import { SessionSettingsSchema } from '@shared/types'

const getSettingsMock = vi.fn()
const lastUsedState = {
  chat: undefined as { provider: string; modelId: string } | undefined,
  picture: undefined as { provider: string; modelId: string } | undefined,
}

vi.mock('./settingsStore', () => ({
  getPlatformDefaultDocumentParser: () => ({ type: 'local' }),
  settingsStore: {
    getState: () => ({
      getSettings: getSettingsMock,
    }),
  },
}))

vi.mock('./lastUsedModelStore', () => ({
  lastUsedModelStore: {
    getState: () => lastUsedState,
  },
}))

vi.mock('@/i18n', () => ({
  default: { t: (value: string) => value },
}))

vi.mock('@/platform', () => ({ default: {} }))
vi.mock('@/storage', () => ({ default: {} }))
vi.mock('@/lib/format-chat', () => ({
  formatChatAsHtml: vi.fn(),
  formatChatAsMarkdown: vi.fn(),
  formatChatAsTxt: vi.fn(),
}))
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('@/packages/context-management/attachment-payload', () => ({ PREVIEW_LINES: 20 }))
vi.mock('@/packages/local-parser', () => ({}))
vi.mock('@/packages/token', () => ({ estimateTokens: vi.fn(), getTokenizerType: () => 'default' }))
vi.mock('@/packages/video', () => ({
  dataUrlToBlob: vi.fn(),
  extractVideoFrames: vi.fn(),
  extractVideoPoster: vi.fn(),
  formatBytesForDisplay: vi.fn(),
  getVideoLimits: vi.fn(),
  loadVideoMetadata: vi.fn(),
  readAsDataUrl: vi.fn(),
}))
vi.mock('@/packages/video-url', () => ({
  formatVideoUrlAttachmentContent: vi.fn(),
  isSupportedVideoUrl: vi.fn(),
  readVideoUrl: vi.fn(),
  storeRemoteThumbnail: vi.fn(),
  videoUrlAttachmentTitle: vi.fn(),
}))
vi.mock('@/storage/StoreStorage', () => ({ StorageKey: {}, StorageKeyGenerator: {} }))
vi.mock('@/utils/session-utils', () => ({ migrateSession: vi.fn(), sortSessions: vi.fn() }))

import { initEmptyChatSession, initEmptyPictureSession, mergeSettings } from './sessionHelpers'

describe('sessionHelpers reasoning defaults', () => {
  beforeEach(() => {
    getSettingsMock.mockReset()
    lastUsedState.chat = undefined
    lastUsedState.picture = undefined
  })

  it('merges global provider options into chat session settings', () => {
    const globalSettings = getDefaultSettings()

    const merged = mergeSettings(globalSettings, {
      provider: 'openai',
      modelId: 'gpt-4o',
    })

    expect(merged.providerOptions?.openai?.reasoningEffort).toBe('medium')
  })

  it('lets session provider options override the global reasoning default', () => {
    const globalSettings = getDefaultSettings()

    const merged = mergeSettings(globalSettings, {
      provider: 'openai',
      modelId: 'gpt-4o',
      providerOptions: {
        openai: {
          reasoningEffort: 'high',
        },
      },
    })

    expect(merged.providerOptions?.openai?.reasoningEffort).toBe('high')
  })

  it('seeds a new chat session with the global reasoning default', () => {
    getSettingsMock.mockReturnValue(getDefaultSettings())

    const session = initEmptyChatSession()
    const parsed = SessionSettingsSchema.parse(session.settings)

    expect(parsed.providerOptions?.openai?.reasoningEffort).toBe('medium')
  })
})

describe('new session model', () => {
  // A custom provider is set up once it lists models.
  const withProviders = (ids: string[], defaultChatModel?: { provider: string; model: string }) => ({
    ...getDefaultSettings(),
    customProviders: ids.map((id) => ({ id, name: id, type: 'openai', isCustom: true })),
    providers: Object.fromEntries(ids.map((id) => [id, { models: [{ modelId: 'm1' }] }])),
    defaultChatModel,
  })

  beforeEach(() => {
    getSettingsMock.mockReset()
    lastUsedState.chat = undefined
    lastUsedState.picture = undefined
  })

  it('starts on the default chat model when its provider is set up', () => {
    getSettingsMock.mockReturnValue(
      withProviders(['custom-provider-a'], { provider: 'custom-provider-a', model: 'm1' })
    )
    lastUsedState.chat = { provider: 'custom-provider-b', modelId: 'm1' }

    expect(initEmptyChatSession().settings).toMatchObject({ provider: 'custom-provider-a', modelId: 'm1' })
  })

  it('skips a last-used model whose provider was removed and uses the default', () => {
    getSettingsMock.mockReturnValue(
      withProviders(['custom-provider-a'], { provider: 'custom-provider-a', model: 'm1' })
    )
    lastUsedState.chat = { provider: 'custom-provider-gone', modelId: 'm1' }

    expect(initEmptyChatSession().settings).toMatchObject({ provider: 'custom-provider-a', modelId: 'm1' })
  })

  it('falls back to the last-used model when the default is no longer set up', () => {
    getSettingsMock.mockReturnValue(
      withProviders(['custom-provider-b'], { provider: 'custom-provider-gone', model: 'm1' })
    )
    lastUsedState.chat = { provider: 'custom-provider-b', modelId: 'm1' }

    expect(initEmptyChatSession().settings).toMatchObject({ provider: 'custom-provider-b', modelId: 'm1' })
  })

  it('has no model, never OpenAI, when nothing usable is chosen', () => {
    getSettingsMock.mockReturnValue(withProviders(['custom-provider-a']))
    lastUsedState.chat = { provider: 'openai', modelId: 'gpt-4o' }

    const settings = initEmptyChatSession().settings
    expect(settings?.provider).toBeUndefined()
    expect(settings?.modelId).toBeUndefined()
  })

  it('starts a picture chat on the last-used picture model only when it is set up', () => {
    getSettingsMock.mockReturnValue(withProviders(['custom-provider-a']))
    lastUsedState.picture = { provider: 'custom-provider-a', modelId: 'm1' }
    expect(initEmptyPictureSession().settings).toMatchObject({ provider: 'custom-provider-a', modelId: 'm1' })

    lastUsedState.picture = { provider: 'openai', modelId: 'gpt-image-1' }
    expect(initEmptyPictureSession().settings?.provider).toBeUndefined()
  })
})

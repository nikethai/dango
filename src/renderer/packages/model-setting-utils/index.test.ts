import { settings as getDefaultSettings } from '@shared/defaults'
import { describe, expect, it } from 'vitest'
import { getModelDisplayName } from './index'

describe('getModelDisplayName', () => {
  it('names no provider when the chat has no model', async () => {
    expect(await getModelDisplayName({}, getDefaultSettings(), 'chat')).toBe('')
  })

  it('names the chosen provider and model', async () => {
    expect(
      await getModelDisplayName({ provider: 'openai', modelId: 'gpt-4o' }, getDefaultSettings(), 'chat')
    ).toContain('gpt-4o')
  })
})

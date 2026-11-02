/**
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest'
import { formatModelTitle } from './SessionStatusBar'

describe('formatModelTitle', () => {
  it('shows the provider name next to the model', () => {
    expect(formatModelTitle('Fake Model', 'Fake W')).toBe('Fake W · Fake Model')
  })

  it('shows the model alone without a provider name', () => {
    expect(formatModelTitle('Fake Model')).toBe('Fake Model')
  })

  it('skips the provider when the model already names it', () => {
    expect(formatModelTitle('xAI Grok 4.5', 'xAI')).toBe('xAI Grok 4.5')
    expect(formatModelTitle('GPT-5', 'OpenAI')).toBe('GPT-5')
  })
})

/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
const selector = vi.hoisted(() => ({ props: undefined as undefined | Record<string, unknown> }))
vi.mock('../ModelSelector', () => ({
  ModelSelector: (props: { children: ReactNode } & Record<string, unknown>) => {
    selector.props = props
    return <>{props.children}</>
  },
}))

import { canUseToolsModelFilter, ModelReadinessNotice } from './ModelReadinessNotice'

afterEach(cleanup)

const er4 = { status: 'capability-required', providerId: 'p', modelId: 'm', capability: 'tool_use' } as const

describe('ModelReadinessNotice (ER4)', () => {
  it('names the model and offers Answer without tools, then Choose a model', () => {
    const onAnswerWithoutTools = vi.fn()
    const onSelectModel = vi.fn()
    render(
      <ModelReadinessNotice
        readiness={er4}
        modelName="Tiny 1B"
        onAnswerWithoutTools={onAnswerWithoutTools}
        onSelectModel={onSelectModel}
      />
    )
    expect(screen.getByText("Tiny 1B can't use tools.")).toBeTruthy()
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Answer without tools', 'Choose a model'])
    fireEvent.click(screen.getByRole('button', { name: 'Answer without tools' }))
    expect(onAnswerWithoutTools).toHaveBeenCalledTimes(1)
    // Choose a model is the user's own pick, in a picker of models that can use tools.
    expect(selector.props?.modelFilter).toBe(canUseToolsModelFilter)
    ;(selector.props?.onSelect as (p: string, m: string) => void)('openai', 'gpt-4o')
    expect(onSelectModel).toHaveBeenCalledWith('openai', 'gpt-4o')
  })

  it('the picker keeps tool models and models with unknown capabilities', () => {
    expect(canUseToolsModelFilter({ modelId: 'a', capabilities: ['tool_use'] })).toBe(true)
    expect(canUseToolsModelFilter({ modelId: 'b' })).toBe(true)
    expect(canUseToolsModelFilter({ modelId: 'c', capabilities: ['vision'] })).toBe(false)
  })
})

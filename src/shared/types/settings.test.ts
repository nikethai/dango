import { describe, expect, it } from 'vitest'
import * as defaults from '../defaults'
import { readBackgroundPaused, readCostWarningUsd, readShowThinking, readTrustLevel, SettingsSchema } from './settings'

const KEYS = ['trustLevel', 'costWarningUsd', 'showThinking', 'backgroundPaused'] as const

function pick(parsed: Record<string, unknown>) {
  return Object.fromEntries(KEYS.map((k) => [k, parsed[k]]))
}

describe('trust, cost, thinking and background settings', () => {
  it('defaults carry the new fields', () => {
    expect(pick(defaults.settings())).toEqual({
      trustLevel: 'auto',
      costWarningUsd: 0.5,
      showThinking: 'auto',
      backgroundPaused: false,
    })
  })

  it('an old settings payload gets the defaults', () => {
    const old: Record<string, unknown> = { ...defaults.settings() }
    for (const k of KEYS) delete old[k]
    expect(pick(SettingsSchema.parse(old))).toEqual({
      trustLevel: 'auto',
      costWarningUsd: 0.5,
      showThinking: 'auto',
      backgroundPaused: false,
    })
  })

  it('junk values fall back', () => {
    const parse = (patch: Record<string, unknown>) => SettingsSchema.parse({ ...defaults.settings(), ...patch })
    expect(parse({ trustLevel: 'sometimes' }).trustLevel).toBe('auto')
    for (const bad of [-1, 'abc', Number.NaN]) expect(parse({ costWarningUsd: bad }).costWarningUsd).toBe(0.5)
    expect(parse({ showThinking: 'always' }).showThinking).toBe('auto')
    expect(parse({ backgroundPaused: 'yes' }).backgroundPaused).toBe(false)
  })

  it('zero turns the cost warning off and is kept', () => {
    const parsed = SettingsSchema.parse({
      ...defaults.settings(),
      costWarningUsd: 0,
      trustLevel: 'ask',
      showThinking: 'closed',
      backgroundPaused: true,
    })
    expect(pick(parsed)).toEqual({
      trustLevel: 'ask',
      costWarningUsd: 0,
      showThinking: 'closed',
      backgroundPaused: true,
    })
  })

  it('normalisers coerce bad stored values', () => {
    expect(readTrustLevel('sometimes')).toBe('auto')
    expect(readTrustLevel('ask')).toBe('ask')
    expect(readCostWarningUsd(undefined)).toBe(0.5)
    expect(readCostWarningUsd(0)).toBe(0)
    expect(readShowThinking(null)).toBe('auto')
    expect(readShowThinking('open')).toBe('open')
    expect(readBackgroundPaused('yes')).toBe(false)
    expect(readBackgroundPaused(true)).toBe(true)
  })
})

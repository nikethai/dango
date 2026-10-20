import { describe, expect, it } from 'vitest'
import { inertValue, inertValues } from './i18n-values'

describe('inertValue', () => {
  it('breaks {{ and }} so an i18n formatter cannot expand them, and leaves other text alone', () => {
    expect(inertValue('A {{what}} co')).toBe('A {​{what}​} co')
    expect(inertValue('Acme Co')).toBe('Acme Co')
    expect(inertValue('{{{x}}}')).not.toMatch(/\{\{|\}\}/)
  })

  it('inertValues maps every value', () => expect(inertValues({ a: '{{b}}', c: 'd' })).toEqual({ a: '{​{b}​}', c: 'd' }))
})

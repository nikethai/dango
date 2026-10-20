import type { CommandPackage, SkillPackage } from '@shared/types'
import { describe, expect, it, vi } from 'vitest'
import { buildCommandPickerItems, type CommandPickerItem } from './CommandPicker'

// The picker's empty state links to Settings; that module touches localStorage at import time.
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))

function skill(name: string, description = 'Reviews a diff for bugs'): SkillPackage {
  return { id: `skill-${name}`, name, description, instructions: '', enabled: true, source: 'user' } as SkillPackage
}

function command(name: string, description = 'Ship the build'): CommandPackage {
  return { id: `cmd-${name}`, name, description, enabled: true } as CommandPackage
}

const kinds = (items: CommandPickerItem[]) => items.map((item) => item.kind)
const names = (items: CommandPickerItem[]) =>
  items.map((item) => (item.kind === 'skill' ? item.skill.name : item.command.name))

describe('buildCommandPickerItems', () => {
  const skills = [skill('review-code')]
  const commands = [command('deploy')]

  it('lists skills first, then system commands, then package commands', () => {
    const items = buildCommandPickerItems('', commands, { skills })
    expect(kinds(items)).toEqual(['skill', 'system', 'system', 'package'])
    const lastSkill = kinds(items).lastIndexOf('skill')
    const firstCommand = kinds(items).findIndex((kind) => kind !== 'skill')
    expect(lastSkill).toBeLessThan(firstCommand)
  })

  it('keeps only matching items for a query', () => {
    const items = buildCommandPickerItems('rev', commands, { skills })
    expect(names(items)).toEqual(['review-code'])
  })

  it('hides skills already chosen', () => {
    const items = buildCommandPickerItems('', commands, { skills, excludeSkillIds: ['skill-review-code'] })
    expect(kinds(items)).not.toContain('skill')
  })

  it('caps skills at 5 and package commands at 8', () => {
    const many = Array.from({ length: 7 }, (_, i) => skill(`skill-${i}`))
    const cmds = Array.from({ length: 10 }, (_, i) => command(`cmd-${i}`))
    const items = buildCommandPickerItems('', cmds, { skills: many })
    expect(kinds(items).filter((k) => k === 'skill')).toHaveLength(5)
    expect(kinds(items).filter((k) => k === 'package')).toHaveLength(8)
  })

  it('puts a system command first when the query names it exactly', () => {
    const rewriteSkills = [skill('rewrite-helper', 'Rewrites text'), skill('compact-notes', 'Compact notes')]
    expect(names(buildCommandPickerItems('rewrite', commands, { skills: rewriteSkills }))[0]).toBe('rewrite')
    expect(names(buildCommandPickerItems('compact', commands, { skills: rewriteSkills }))[0]).toBe('compact')
    const viaAlias = buildCommandPickerItems('summarize', commands, { skills: [skill('summarize-doc', 'Summarize')] })
    expect(viaAlias[0]).toMatchObject({ kind: 'system', command: { id: 'compact' } })
  })

  it('puts a saved command first when the query names it exactly (after an exact built-in)', () => {
    const deploySkills = [skill('deploy-checklist', 'Deploy steps')]
    const items = buildCommandPickerItems('deploy', commands, { skills: deploySkills })
    expect(items[0]).toMatchObject({ kind: 'package', command: { name: 'deploy' } })
    expect(names(items)).toEqual(['deploy', 'deploy-checklist'])
    // A saved command named like a built-in never pushes the built-in down.
    const clash = buildCommandPickerItems('rewrite', [command('rewrite', 'My rewrite')], {})
    expect(kinds(clash).slice(0, 2)).toEqual(['system', 'package'])
  })

  it('leaves out system commands when includeSystem is false', () => {
    const items = buildCommandPickerItems('', commands, { skills, includeSystem: false })
    expect(kinds(items)).toEqual(['skill', 'package'])
  })
})

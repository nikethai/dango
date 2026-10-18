import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildSettingsNav, findSettingsEntry, type SettingsNavAvailability } from './settingsNavModel'

const ALL: SettingsNavAvailability = { agents: true, mcp: true, knowledgeBase: true, hotkeys: true, devTools: true }
const NONE: SettingsNavAvailability = {
  agents: false,
  mcp: false,
  knowledgeBase: false,
  hotkeys: false,
  devTools: false,
}

describe('settings nav model', () => {
  it('five sections in order', () => {
    expect(buildSettingsNav(ALL).sections.map((e) => e.label)).toEqual([
      'Models and keys',
      'Sources',
      'Memory and privacy',
      'Voice',
      'General',
    ])
  })

  it('advanced rows in order', () => {
    expect(buildSettingsNav(ALL).advanced.map((e) => e.label)).toEqual([
      'Usage',
      'Web search providers',
      'Browser agent',
      'Computer use',
      'Image studio',
      'Video URL · Document parser',
      'Chat settings',
      'Skills · Commands · Hooks',
      'Agents · MCP',
      'Dev tools',
    ])
  })

  it('gated pages drop out', () => {
    const nav = buildSettingsNav(NONE)
    const all = [...nav.sections, ...nav.advanced]
    expect(all.find((e) => e.id === 'agents-mcp')).toBeUndefined()
    expect(all.find((e) => e.id === 'dev')).toBeUndefined()
    expect(nav.sections.find((e) => e.id === 'sources')?.pages.map((p) => p.label)).toEqual(['Sources', 'Accounts'])
    expect(nav.sections.find((e) => e.id === 'general')?.pages.map((p) => p.label)).toEqual(['General'])
    const mcpOnly = buildSettingsNav({ ...NONE, mcp: true })
    expect(mcpOnly.advanced.find((e) => e.id === 'agents-mcp')?.label).toBe('MCP')
  })

  it('every settings route is reachable', () => {
    const dir = join(__dirname, '../../routes/settings')
    const files: { name: string; source: string }[] = []
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.tsx') || f.endsWith('.test.tsx') || f.startsWith('-')) continue
      if (f === 'route.tsx' || f === 'index.tsx') continue
      files.push({ name: f.replace(/\.tsx$/, ''), source: readFileSync(join(dir, f), 'utf8') })
    }
    files.push({ name: 'provider', source: readFileSync(join(dir, 'provider/route.tsx'), 'utf8') })
    const paths = files.filter((f) => !f.source.includes('throw redirect(')).map((f) => `/settings/${f.name}`)
    const nav = buildSettingsNav(ALL)
    const tos = new Set([...nav.sections, ...nav.advanced].flatMap((e) => e.pages.map((p) => p.to)))
    expect(paths.filter((p) => !tos.has(p))).toEqual([])
  })

  it('every nav page has a route', () => {
    const nav = buildSettingsNav(ALL)
    const tos = [...nav.sections, ...nav.advanced].flatMap((e) => e.pages.map((p) => p.to))
    const dir = join(__dirname, '../../routes/settings')
    const missing = tos
      .filter((to) => to.startsWith('/settings/'))
      .filter((to) => {
        const name = to.slice('/settings/'.length)
        return !existsSync(join(dir, `${name}.tsx`)) && !existsSync(join(dir, name, 'route.tsx'))
      })
    expect(missing).toEqual([])
  })

  it('deep links resolve', () => {
    const nav = buildSettingsNav(ALL)
    const hooks = findSettingsEntry(nav, '/settings/hooks')
    expect([hooks?.entry.id, hooks?.page.label, hooks?.inAdvanced]).toEqual(['skills', 'Hooks', true])
    const openai = findSettingsEntry(nav, '/settings/provider/openai')
    expect([openai?.entry.id, openai?.page.label, openai?.inAdvanced]).toEqual(['models', 'Providers', false])
    expect(findSettingsEntry(nav, '/settings/voice/')?.entry.id).toBe('voice')
    expect(findSettingsEntry(nav, '/settings')).toBeNull()
    expect(findSettingsEntry(buildSettingsNav(NONE), '/settings/agents')).toBeNull()
  })

  it('image studio leaves settings', () => {
    const entry = buildSettingsNav(ALL).advanced.find((e) => e.id === 'image-studio')
    expect(entry?.pages[0].to).toBe('/image-creator')
    expect(entry?.leavesSettings).toBe(true)
  })
})

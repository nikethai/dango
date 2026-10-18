import {
  AppWindow,
  Bot,
  ChartColumn,
  Code,
  FileText,
  Globe,
  ImagePlus,
  KeyRound,
  type LucideIcon,
  MessageSquare,
  Mic,
  Monitor,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react'

export type SettingsNavPage = { key: string; label: string; to: string }
export type SettingsNavEntry = {
  id: string
  label: string
  icon: LucideIcon
  pages: SettingsNavPage[]
  leavesSettings?: boolean
}
export type SettingsNav = { sections: SettingsNavEntry[]; advanced: SettingsNavEntry[] }
export type SettingsNavAvailability = {
  agents: boolean
  mcp: boolean
  knowledgeBase: boolean
  hotkeys: boolean
  devTools: boolean
}

export const ADVANCED_LABEL = 'Advanced'

type PageSpec = { key: string; label?: string; to: string; flag?: keyof SettingsNavAvailability }
type EntrySpec = {
  id: string
  /** Omitted: the remaining page labels joined with ' · '. */
  label?: string
  icon: LucideIcon
  pages: PageSpec[]
  leavesSettings?: boolean
}

const SECTIONS: EntrySpec[] = [
  {
    id: 'models',
    label: 'Models and keys',
    icon: KeyRound,
    pages: [
      { key: 'provider', label: 'Providers', to: '/settings/provider' },
      { key: 'default-models', label: 'Default models', to: '/settings/default-models' },
    ],
  },
  {
    id: 'sources',
    label: 'Sources',
    icon: Plug,
    pages: [
      { key: 'sources', label: 'Sources', to: '/settings/sources' },
      { key: 'integrations', label: 'Accounts', to: '/settings/integrations' },
      { key: 'knowledge-base', label: 'Documents', to: '/settings/knowledge-base', flag: 'knowledgeBase' },
    ],
  },
  {
    id: 'privacy',
    label: 'Memory and privacy',
    icon: ShieldCheck,
    pages: [
      { key: 'privacy', label: 'Privacy', to: '/settings/privacy' },
      { key: 'memory', label: 'Memory', to: '/settings/memory' },
      { key: 'sync', label: 'Sync', to: '/settings/sync' },
    ],
  },
  { id: 'voice', label: 'Voice', icon: Mic, pages: [{ key: 'voice', to: '/settings/voice' }] },
  {
    id: 'general',
    label: 'General',
    icon: SlidersHorizontal,
    pages: [
      { key: 'general', label: 'General', to: '/settings/general' },
      { key: 'hotkeys', label: 'Keyboard shortcuts', to: '/settings/hotkeys', flag: 'hotkeys' },
    ],
  },
]

const ADVANCED: EntrySpec[] = [
  { id: 'usage', label: 'Usage', icon: ChartColumn, pages: [{ key: 'usage', to: '/settings/usage' }] },
  {
    id: 'web-search',
    label: 'Web search providers',
    icon: Globe,
    pages: [{ key: 'web-search', to: '/settings/web-search' }],
  },
  {
    id: 'browser-agent',
    label: 'Browser agent',
    icon: AppWindow,
    pages: [{ key: 'browser-agent', to: '/settings/browser-agent' }],
  },
  {
    id: 'computer-use',
    label: 'Computer use',
    icon: Monitor,
    pages: [{ key: 'computer-use', to: '/settings/computer-use' }],
  },
  {
    id: 'image-studio',
    label: 'Image studio',
    icon: ImagePlus,
    pages: [{ key: 'image-studio', to: '/image-creator' }],
    leavesSettings: true,
  },
  {
    id: 'video-docs',
    icon: FileText,
    pages: [
      { key: 'video-url', label: 'Video URL', to: '/settings/video-url' },
      { key: 'document-parser', label: 'Document parser', to: '/settings/document-parser' },
    ],
  },
  { id: 'chat', label: 'Chat settings', icon: MessageSquare, pages: [{ key: 'chat', to: '/settings/chat' }] },
  {
    id: 'skills',
    icon: Sparkles,
    pages: [
      { key: 'skills', label: 'Skills', to: '/settings/skills' },
      { key: 'commands', label: 'Commands', to: '/settings/commands' },
      { key: 'hooks', label: 'Hooks', to: '/settings/hooks' },
    ],
  },
  {
    id: 'agents-mcp',
    icon: Bot,
    pages: [
      { key: 'agents', label: 'Agents', to: '/settings/agents', flag: 'agents' },
      { key: 'mcp', label: 'MCP', to: '/settings/mcp', flag: 'mcp' },
    ],
  },
  {
    id: 'dev',
    label: 'Dev tools',
    icon: Code,
    pages: [{ key: 'dev', to: '/dev', flag: 'devTools' }],
    leavesSettings: true,
  },
]

function buildEntries(specs: EntrySpec[], available: SettingsNavAvailability): SettingsNavEntry[] {
  const entries: SettingsNavEntry[] = []
  for (const spec of specs) {
    const pages: SettingsNavPage[] = spec.pages
      .filter((p) => !p.flag || available[p.flag])
      .map((p) => ({ key: p.key, label: p.label ?? spec.label ?? p.key, to: p.to }))
    if (pages.length === 0) continue
    const entry: SettingsNavEntry = {
      id: spec.id,
      label: spec.label ?? pages.map((p) => p.label).join(' · '),
      icon: spec.icon,
      pages,
    }
    if (spec.leavesSettings) entry.leavesSettings = true
    entries.push(entry)
  }
  return entries
}

export function buildSettingsNav(available: SettingsNavAvailability): SettingsNav {
  return { sections: buildEntries(SECTIONS, available), advanced: buildEntries(ADVANCED, available) }
}

function stripTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function findSettingsEntry(
  nav: SettingsNav,
  pathname: string
): { entry: SettingsNavEntry; page: SettingsNavPage; inAdvanced: boolean } | null {
  const path = stripTrailingSlash(pathname)
  const groups: [SettingsNavEntry[], boolean][] = [
    [nav.sections, false],
    [nav.advanced, true],
  ]
  for (const [entries, inAdvanced] of groups) {
    for (const entry of entries) {
      for (const page of entry.pages) {
        if (path === page.to || path.startsWith(`${page.to}/`)) {
          return { entry, page, inAdvanced }
        }
      }
    }
  }
  return null
}

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// English UI copy is sentence case: only the first word, proper nouns and acronyms are capitalized.
// Sentences may name a page or button ("Check it in Settings."), so this checks short labels only.
const en: Record<string, string> = JSON.parse(
  readFileSync(resolve(process.cwd(), 'src/renderer/i18n/locales/en/translation.json'), 'utf8')
)

// product, company, OS and place names that keep their capitals
const PROPER = new Set([
  'Dango',
  'Gmail',
  'Asana',
  'Codex',
  'Gemini',
  'Google',
  'Claude',
  'Azure',
  'Microsoft',
  'Windows',
  'Linux',
  'Markdown',
  'Mermaid',
  'Whisper',
  'Tavily',
  'Serper',
  'Exa',
  'Bing',
  'DuckDuckGo',
  'Office',
  'Keynote',
  'Pages',
  'Finder',
  'Node',
  'Docker',
  'Anthropic',
  'Ollama',
  'Cloudflare',
  'Tunnel',
  'Groq',
  'Grok',
  'Jira',
  'Slack',
  'Antigravity',
  'Premium',
  'Plus',
  'Pro',
  'English',
  'Spanish',
  'Chinese',
  'Japanese',
  'Everywhere',
  'Xiaohongshu',
  'China',
  'Singapore',
  'Esc',
  'Enter',
  'Ctrl',
  'Shift',
  'Homebrew',
  'Pixar',
  // OpenAI's Responses API, Cloudflare Access, the 'Ask first' trust level, 'Acme Co' (example company)
  'Responses',
  'Co',
])

// labels that name a page (Review, Usage, Integrations, Settings), a trust level (Auto, Ask first), a legal
// document, or Cloudflare Access
const ALLOWED = new Set([
  'Privacy Policy',
  'Terms of Service',
  'User Terms',
  'Waiting in Review: it contradicts "{{old}}"',
  '{{n}} more in Review',
  'Use Auto',
  'Use Ask first',
  'Open Review',
  'Open Integrations',
  'Open Usage',
  'Enable in Settings → Browser agent',
  'Enable in Settings → Computer use',
  'CF Access service token client secret',
])

const isLabel = (value: string) =>
  !/[.!?](\s|$)|\n|<|—/.test(value) && value.split(/\s+/).length <= 8 && /[A-Za-z]/.test(value)

// capitalized words after the first one that are not proper nouns; "Settings → Backup" style paths and
// "[Ctrl+Enter] Save, …" key hints start a new label after the arrow or bracket
const offendingWords = (value: string) => {
  const offenders: string[] = []
  const stripped = value.replace(/\{\{[^}]*\}\}|https?:\/\/\S+/g, ' ')
  for (const clause of stripped.split(/→|›|·|\||:|…|\s[-–]\s|\[[^\]]*\]|"|“|”/)) {
    const words = clause.split(/[\s/]+/).filter((word) => /[A-Za-z]/.test(word))
    for (const word of words.slice(1)) {
      for (const part of word.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '').split('-')) {
        if (/^[A-Z][a-z]+$/.test(part) && !PROPER.has(part)) {
          offenders.push(part)
        }
      }
    }
  }
  return offenders
}

describe('English UI labels', () => {
  it('finds labels to check', () => {
    expect(Object.values(en).filter(isLabel).length).toBeGreaterThan(500)
  })

  it('are sentence case', () => {
    const offenders = Object.values(en)
      .filter(isLabel)
      .filter((value) => !ALLOWED.has(value) && offendingWords(value).length > 0)
    expect(offenders).toEqual([])
  })
})

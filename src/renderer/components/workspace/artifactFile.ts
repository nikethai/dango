import type { ArtifactKind } from '@shared/artifacts'

const KIND_EXTENSION: Partial<Record<ArtifactKind, string>> = {
  html: 'html',
  svg: 'svg',
  markdown: 'md',
  mermaid: 'mmd',
}

const LANGUAGE_EXTENSION: Record<string, string> = {
  js: 'js',
  javascript: 'js',
  ts: 'ts',
  typescript: 'ts',
  tsx: 'tsx',
  jsx: 'jsx',
  py: 'py',
  python: 'py',
  css: 'css',
  json: 'json',
  sh: 'sh',
  bash: 'sh',
}

const MAX_BASE_LENGTH = 60

/** File name for downloading an artifact: a slug of its title plus an extension from its kind or language. */
export function artifactFileName(input: { title?: string; kind: ArtifactKind; language?: string }): string {
  const slug = (input.title ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_BASE_LENGTH)
    .replace(/-+$/g, '')
  const extension = KIND_EXTENSION[input.kind] ?? LANGUAGE_EXTENSION[(input.language ?? '').toLowerCase()] ?? 'txt'
  return `${slug || 'artifact'}.${extension}`
}

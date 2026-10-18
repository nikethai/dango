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

/**
 * File name for downloading an artifact: a slug of its title plus an extension from its kind or language. The slug
 * keeps letters and digits of any script (so "Bảng giá" and "价格表" keep their names); everything else, including
 * every filesystem-reserved character, becomes a dash. At most 60 characters (not UTF-16 units), no edge dashes.
 */
export function artifactFileName(input: { title?: string; kind: ArtifactKind; language?: string }): string {
  const dashed = (input.title ?? '')
    .normalize('NFC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
  const slug = Array.from(dashed).slice(0, MAX_BASE_LENGTH).join('').replace(/-+$/g, '')
  const extension = KIND_EXTENSION[input.kind] ?? LANGUAGE_EXTENSION[(input.language ?? '').toLowerCase()] ?? 'txt'
  return `${slug || 'artifact'}.${extension}`
}

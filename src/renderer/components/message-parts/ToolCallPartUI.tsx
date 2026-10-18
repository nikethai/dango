/**
 * Tool call chrome — quiet timeline steps, human-readable summaries first.
 * Raw JSON only under optional technical details (power users).
 */

import { Code, Collapse, Stack, Text, UnstyledButton } from '@mantine/core'
import { type MessageToolCallPart, MessageToolCallPartSchema } from '@shared/types'
import {
  IconChevronRight,
  IconCircleCheckFilled,
  IconCircleXFilled,
  IconCode,
  IconExternalLink,
  IconLink,
  IconLoader,
  IconMovie,
  IconSearch,
  IconTool,
  IconWorldWww,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { type FC, type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import z from 'zod'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getToolName } from '@/packages/tools'
import { isTaskTrackingTool } from '@/packages/tools/task-tools'
import { formatDurationForDisplay } from '@/packages/video'
import type { SearchResultItem } from '@/packages/web-search'
import { ScalableIcon } from '../common/ScalableIcon'
import { ImageInStorage } from '../Image'


// ── Helpers ──────────────────────────────────────────────────────────────

const getSafeExternalHref = (raw: string): string | null => {
  const trimmed = raw.trim()
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null
  try {
    return new URL(trimmed).toString()
  } catch {
    try {
      return new URL(trimmed.replace(/%(?![0-9A-Fa-f]{2})/g, '%25')).toString()
    } catch {
      return null
    }
  }
}

const hostnameOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

const previewText = (value: unknown, max = 140): string => {
  if (value == null) return ''
  if (typeof value === 'string') {
    const one = value.replace(/\s+/g, ' ').trim()
    return one.length > max ? `${one.slice(0, max)}…` : one
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const s = JSON.stringify(value)
    return s.length > max ? `${s.slice(0, max)}…` : s
  } catch {
    return ''
  }
}

const toolIconFor = (toolName: string) => {
  switch (toolName) {
    case 'web_search':
      return IconWorldWww
    case 'parse_link':
      return IconLink
    case 'read_video':
    case 'read_video_url':
      return IconMovie
    case 'file_search':
    case 'code_search':
    case 'query_knowledge_base':
      return IconSearch
    case 'memory_lookup':
    case 'memory_recall':
    case 'memory_list':
    case 'memory_retain':
    case 'memory_reflect':
    case 'memory_update':
    case 'memory_forget':
      return IconSearch
    default:
      return IconTool
  }
}

// ── Header ───────────────────────────────────────────────────────────────

const ToolCallHeader: FC<{
  toolName: string
  state: MessageToolCallPart['state']
  summary?: string
  /** Optional product badge e.g. "via Work Jira" — never tokens */
  badge?: string
  /** Consecutive identical runs collapsed into one row */
  runCount?: number
  expanded: boolean
  onClick: () => void
  trailing?: ReactNode
}> = ({ toolName, state, summary, badge, runCount, expanded, onClick, trailing }) => {
  const isSmallScreen = useIsSmallScreen()
  const Icon = toolIconFor(toolName)

  return (
    <button
      type="button"
      className={clsx('tool-step-header', expanded && 'is-open', isSmallScreen && 'is-mobile')}
      onClick={onClick}
      aria-expanded={expanded}
    >
      <span className="tool-step-icon" aria-hidden>
        <ScalableIcon icon={Icon} size={13} />
      </span>
      <span className="tool-step-main min-w-0 flex-1">
        <span className="tool-step-title">{getToolName(toolName)}</span>
        {runCount && runCount > 1 ? <span className="tool-step-count">×{runCount}</span> : null}
        {badge ? (
          <span className="tool-step-badge" title={badge}>
            {badge}
          </span>
        ) : null}
        {summary && !expanded && <span className="tool-step-summary">{summary}</span>}
      </span>
      <span className="tool-step-meta shrink-0">
        {state === 'call' ? (
          <ScalableIcon icon={IconLoader} size={13} className="animate-spin" color="var(--chatbox-tint-brand)" />
        ) : state === 'error' ? (
          <ScalableIcon icon={IconCircleXFilled} size={13} color="var(--chatbox-tint-error)" />
        ) : (
          <ScalableIcon
            icon={IconCircleCheckFilled}
            size={13}
            className="opacity-80"
            color="var(--chatbox-tint-success)"
          />
        )}
        {trailing}
        <ScalableIcon icon={IconChevronRight} size={13} className={clsx('tool-step-chevron', expanded && 'is-open')} />
      </span>
    </button>
  )
}

// ── Shared body chrome ───────────────────────────────────────────────────

const ToolStepBody: FC<{ children: ReactNode }> = ({ children }) => <div className="tool-step-body">{children}</div>

const FieldLabel: FC<{ children: ReactNode }> = ({ children }) => (
  <Text size="xs" fw={600} c="chatbox-tertiary" tt="uppercase" className="tool-step-field-label" m={0}>
    {children}
  </Text>
)

const TechnicalDetails: FC<{ args: unknown; result?: unknown }> = ({ args, result }) => {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="tool-step-tech">
      <UnstyledButton type="button" className="tool-step-tech-toggle" onClick={() => setOpen((v) => !v)}>
        <ScalableIcon icon={IconCode} size={13} />
        <span>{t('Technical details')}</span>
        <ScalableIcon icon={IconChevronRight} size={12} className={clsx('tool-step-chevron', open && 'is-open')} />
      </UnstyledButton>
      <Collapse in={open}>
        <Stack gap="xs" mt={6}>
          <FieldLabel>{t('Arguments')}</FieldLabel>
          <Code block className="tool-step-code">
            {JSON.stringify(args, null, 2)}
          </Code>
          {result !== undefined && (
            <>
              <FieldLabel>{t('Result')}</FieldLabel>
              <Code block className="tool-step-code">
                {JSON.stringify(result, null, 2)}
              </Code>
            </>
          )}
        </Stack>
      </Collapse>
    </div>
  )
}

// ── Web search ───────────────────────────────────────────────────────────

const WebBrowsingToolCallPartSchema = MessageToolCallPartSchema.extend({
  toolName: z.literal('web_search'),
  args: z.object({
    query: z.string(),
  }),
  result: z
    .object({
      query: z.string(),
      searchResults: z.array(
        z.object({
          title: z.string(),
          snippet: z.string(),
          link: z.string(),
        })
      ),
    })
    .optional(),
})

type WebBrowsingToolCallPart = MessageToolCallPart<
  { query: string },
  { query: string; searchResults: SearchResultItem[] }
>

/** Compact strip card (collapsed rail) */
const SearchResultChip: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  const href = getSafeExternalHref(result.link)
  const host = hostnameOf(result.link)
  const inner = (
    <div className="tool-search-card" title={result.title}>
      <div className="tool-search-card-top">
        <span className="tool-search-card-index tabular-nums">{index + 1}</span>
        <span className="tool-search-card-host">{host}</span>
        {href && <ScalableIcon icon={IconExternalLink} size={12} className="tool-search-card-ext" />}
      </div>
      <Text size="sm" fw={500} lineClamp={2} m={0} className="tool-search-card-title">
        {result.title}
      </Text>
    </div>
  )
  if (!href) return inner
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tool-search-card-link">
      {inner}
    </a>
  )
}

/** Full-width result row (expanded body) */
const SearchResultRow: FC<{ index: number; result: SearchResultItem }> = ({ index, result }) => {
  const href = getSafeExternalHref(result.link)
  const host = hostnameOf(result.link)
  const inner = (
    <div className="tool-search-row">
      <span className="tool-search-row-index tabular-nums">{index + 1}</span>
      <div className="tool-search-row-main min-w-0">
        <div className="tool-search-row-host-line">
          <span className="tool-search-row-host">{host || tFallbackHost(result.link)}</span>
          {href ? <ScalableIcon icon={IconExternalLink} size={12} className="tool-search-card-ext" /> : null}
        </div>
        <p className="tool-search-row-title">{result.title || host}</p>
        {result.snippet ? <p className="tool-search-row-snippet">{previewText(result.snippet, 180)}</p> : null}
      </div>
    </div>
  )
  if (!href) return inner
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="tool-search-row-link">
      {inner}
    </a>
  )
}

function tFallbackHost(link: string): string {
  return link ? previewText(link, 40) : '—'
}

const WebSearchToolCallUI: FC<{ part: WebBrowsingToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const results = part.result?.searchResults ?? []
  const count = results.length
  const query = part.args?.query?.trim() || part.result?.query?.trim() || ''

  const summary = useMemo(() => {
    if (part.state === 'call') return t('Searching…')
    if (part.state === 'error') return t('Failed')
    if (count > 0) {
      const q = query ? previewText(query, 36) : ''
      return q
        ? t('{{count}} results · “{{query}}”', { count, query: q })
        : t('{{count}} results', { count })
    }
    return query ? t('No results · “{{query}}”', { query: previewText(query, 40) }) : t('No results')
  }, [part.state, count, query, t])

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      {/* Collapsed: horizontal peek strip */}
      {!expanded && count > 0 && (
        <div className="tool-search-strip">
          {results.slice(0, 6).map((result, index) => (
            <SearchResultChip key={`${result.link}-${index}`} index={index} result={result} />
          ))}
        </div>
      )}
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            <div className="tool-search-meta">
              <div className="tool-search-meta-top">
                <span className="tool-search-meta-badge">{t('Web')}</span>
                <span className="tool-search-meta-stat tabular-nums">
                  {part.state === 'call'
                    ? t('Searching…')
                    : count === 0
                      ? t('0 results')
                      : count === 1
                        ? t('1 result')
                        : t('{{count}} results', { count })}
                </span>
              </div>
              {query ? (
                <p className="tool-search-query-text">
                  <span className="tool-search-query-mark">“</span>
                  {query}
                  <span className="tool-search-query-mark">”</span>
                </p>
              ) : null}
            </div>

            {count > 0 ? (
              <div className="tool-search-list">
                {results.map((result, index) => (
                  <SearchResultRow key={`${result.link}-${index}`} index={index} result={result} />
                ))}
              </div>
            ) : part.state === 'call' ? (
              <Text size="sm" c="chatbox-secondary" m={0}>
                {t('Looking up sources…')}
              </Text>
            ) : (
              <div className="tool-search-empty">
                <Text size="sm" fw={500} m={0}>
                  {t('No web results for this query')}
                </Text>
                <Text size="xs" c="chatbox-tertiary" m={0} className="text-pretty">
                  {t('Try simpler keywords, or the model may rely on video captions / other tools instead.')}
                </Text>
              </div>
            )}

            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Parse link ───────────────────────────────────────────────────────────

const ParseLinkResultSchema = z.object({
  url: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  originalLength: z.number().optional(),
  truncated: z.boolean().optional(),
})

const ParseLinkToolCallUI: FC<{ part: MessageToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const args = (part.args ?? {}) as { url?: string }
  const url = typeof args.url === 'string' ? args.url : ''
  const parsed = useMemo(() => ParseLinkResultSchema.safeParse(part.result), [part.result])
  const result = parsed.success ? parsed.data : null
  const href = getSafeExternalHref(url || result?.url || '')
  const host = hostnameOf(url || result?.url || '')
  const contentPreview = result?.content ? previewText(result.content, 180) : ''
  const summary = part.state === 'call' ? host || t('Fetching…') : contentPreview || result?.title || host || undefined

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            {(href || url) && (
              <div>
                <FieldLabel>{t('URL')}</FieldLabel>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="tool-step-url">
                    <span className="truncate">{host || href}</span>
                    <ScalableIcon icon={IconExternalLink} size={13} className="shrink-0" />
                  </a>
                ) : (
                  <Text size="sm" m={0} mt={4} className="break-all">
                    {url}
                  </Text>
                )}
              </div>
            )}
            {result?.title && result.title !== result.url && (
              <div>
                <FieldLabel>{t('Title')}</FieldLabel>
                <Text size="sm" fw={500} m={0} mt={4}>
                  {result.title}
                </Text>
              </div>
            )}
            {result?.content && (
              <div>
                <FieldLabel>{t('Content')}</FieldLabel>
                <div className="tool-step-content-preview">{result.content}</div>
                {result.truncated && (
                  <Text size="xs" c="dimmed" m={0} mt={4}>
                    {t('Truncated')}
                    {result.originalLength != null ? ` · ${result.originalLength.toLocaleString()} chars` : ''}
                  </Text>
                )}
              </div>
            )}
            {part.state === 'error' && (
              <Text size="sm" c="var(--chatbox-tint-error)" m={0}>
                {previewText(part.result) || t('Failed')}
              </Text>
            )}
            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Read video ───────────────────────────────────────────────────────────

const ReadVideoToolCallPartSchema = MessageToolCallPartSchema.extend({
  toolName: z.literal('read_video'),
  args: z
    .object({
      fileKey: z.string().optional(),
      mode: z.string().optional(),
      maxFrames: z.number().optional(),
      timestamps: z.array(z.number()).optional(),
      intervalSec: z.number().optional(),
      startSec: z.number().optional(),
      endSec: z.number().optional(),
    })
    .passthrough()
    .optional(),
  result: z
    .object({
      fileKey: z.string().optional(),
      durationSec: z.number().optional(),
      frames: z
        .array(
          z.object({
            timestampSec: z.number(),
            storageKey: z.string(),
            width: z.number().optional(),
            height: z.number().optional(),
          })
        )
        .optional(),
      remainingBudget: z.number().optional(),
      error: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

type ReadVideoToolCallPart = MessageToolCallPart<
  {
    fileKey?: string
    mode?: string
    maxFrames?: number
    timestamps?: number[]
    intervalSec?: number
    startSec?: number
    endSec?: number
  },
  {
    fileKey?: string
    durationSec?: number
    frames?: Array<{ timestampSec: number; storageKey: string; width?: number; height?: number }>
    remainingBudget?: number
    error?: string
  }
>

function readVideoSummary(
  part: ReadVideoToolCallPart,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | undefined {
  if (part.state === 'call') return t('Reading video…')
  if (part.state === 'error') return t('Failed')
  const result = part.result
  if (result?.error) return previewText(result.error, 72)
  const frames = result?.frames ?? []
  if (frames.length === 0) return t('No frames')
  const times = frames.map((f) => f.timestampSec)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const duration =
    typeof result?.durationSec === 'number' ? formatDurationForDisplay(result.durationSec) : null
  if (frames.length === 1) {
    return duration
      ? t('{{count}} frame · {{time}} · {{duration}}', {
          count: 1,
          time: formatDurationForDisplay(minT),
          duration,
        })
      : t('{{count}} frame · {{time}}', {
          count: 1,
          time: formatDurationForDisplay(minT),
        })
  }
  return t('{{count}} frames · {{start}}–{{end}}', {
    count: frames.length,
    start: formatDurationForDisplay(minT),
    end: formatDurationForDisplay(maxT),
  })
}

const ReadVideoToolCallUI: FC<{ part: ReadVideoToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => readVideoSummary(part, t), [part, t])
  const frames = part.result?.frames ?? []
  const remainingBudget = part.result?.remainingBudget
  const durationSec = part.result?.durationSec
  const mode = part.args?.mode

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            {part.state === 'error' || part.result?.error ? (
              <Text size="sm" c="var(--chatbox-tint-error)" m={0}>
                {previewText(part.result?.error || part.result) || t('Failed')}
              </Text>
            ) : frames.length > 0 ? (
              <>
                <div className="tool-video-meta">
                  <div className="tool-video-meta-top">
                    <span className="tool-video-platform">{t('Local video')}</span>
                    {typeof durationSec === 'number' ? (
                      <span className="tool-video-meta-stat tabular-nums">
                        {formatDurationForDisplay(durationSec)}
                      </span>
                    ) : null}
                    <span className="tool-video-meta-stat tabular-nums">
                      {frames.length === 1
                        ? t('1 frame')
                        : t('{{count}} frames', { count: frames.length })}
                    </span>
                    {mode ? <span className="tool-video-meta-stat">{mode}</span> : null}
                  </div>
                  <Text size="xs" c="chatbox-tertiary" m={0}>
                    {t('Sampled frames sent to the model for vision.')}
                  </Text>
                </div>
                <div className="tool-video-filmstrip" role="list">
                  {frames.map((frame, index) => (
                    <div
                      key={`${frame.storageKey}-${frame.timestampSec}`}
                      className="tool-video-filmstrip-item"
                      role="listitem"
                      style={{ animationDelay: `${Math.min(index, 8) * 40}ms` }}
                    >
                      <div className="tool-video-filmstrip-thumb">
                        <ImageInStorage storageKey={frame.storageKey} className="size-full object-cover" />
                      </div>
                      <span className="tool-video-filmstrip-time font-mono tabular-nums">
                        {formatDurationForDisplay(frame.timestampSec)}
                      </span>
                    </div>
                  ))}
                </div>
                {remainingBudget !== undefined && (
                  <Text size="xs" c="chatbox-tertiary" className="tabular-nums" m={0}>
                    {t('{{count}} frames left in budget this turn', { count: remainingBudget })}
                  </Text>
                )}
              </>
            ) : part.state === 'result' ? (
              <Text size="sm" c="chatbox-secondary" m={0}>
                {t('No frames were sampled from this video.')}
              </Text>
            ) : null}
            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Read video URL ───────────────────────────────────────────────────────

const ReadVideoUrlToolCallPartSchema = MessageToolCallPartSchema.extend({
  toolName: z.literal('read_video_url'),
  args: z
    .object({
      url: z.string().optional(),
      mode: z.string().optional(),
      language: z.string().optional(),
      maxChars: z.number().optional(),
      startSec: z.number().optional(),
      endSec: z.number().optional(),
      maxFrames: z.number().optional(),
      includeTimestamps: z.boolean().optional(),
    })
    .passthrough()
    .optional(),
  result: z
    .object({
      platform: z.string().optional(),
      url: z.string().optional(),
      title: z.string().optional(),
      author: z.string().optional(),
      durationSec: z.number().optional(),
      description: z.string().optional(),
      transcript: z
        .object({
          source: z.string().optional(),
          language: z.string().optional(),
          text: z.string().optional(),
        })
        .passthrough()
        .nullable()
        .optional(),
      warnings: z.array(z.string()).optional(),
      partial: z.boolean().optional(),
      truncated: z.boolean().optional(),
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
    })
    .passthrough()
    .optional(),
})

type ReadVideoUrlToolCallPart = MessageToolCallPart<
  {
    url?: string
    mode?: string
    language?: string
    maxChars?: number
    startSec?: number
    endSec?: number
  },
  {
    platform?: string
    url?: string
    title?: string
    author?: string
    durationSec?: number
    description?: string
    transcript?: { source?: string; language?: string; text?: string } | null
    warnings?: string[]
    partial?: boolean
    truncated?: boolean
    errorCode?: string
    errorMessage?: string
  }
>

function platformLabel(platform?: string): string {
  if (!platform) return ''
  const p = platform.toLowerCase()
  if (p.includes('youtube')) return 'YouTube'
  if (p.includes('vimeo')) return 'Vimeo'
  if (p.includes('tiktok')) return 'TikTok'
  if (p.includes('facebook') || p === 'fb') return 'Facebook'
  return platform
}

function readVideoUrlSummary(
  part: ReadVideoUrlToolCallPart,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | undefined {
  if (part.state === 'call') return t('Reading video…')
  if (part.state === 'error') return t('Failed')
  const result = part.result
  if (result?.errorCode && !result.transcript?.text && !result.title) {
    return previewText(result.errorMessage || result.errorCode, 72)
  }
  const platform = platformLabel(result?.platform)
  const title = result?.title ? previewText(result.title, 42) : ''
  const hasCaptions = Boolean(result?.transcript?.text)
  const bits = [platform, title].filter(Boolean)
  let line = bits.join(' · ') || t('Video link')
  if (hasCaptions) {
    line = `${line} · ${t('captions')}`
  } else if (result?.description) {
    line = `${line} · ${t('description')}`
  } else if (result?.partial) {
    line = `${line} · ${t('partial')}`
  }
  if (result?.truncated) line = `${line} · ${t('truncated')}`
  return previewText(line, 96)
}

const ReadVideoUrlToolCallUI: FC<{ part: ReadVideoUrlToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [showFullTranscript, setShowFullTranscript] = useState(false)
  const summary = useMemo(() => readVideoUrlSummary(part, t), [part, t])
  const result = part.result
  const href = getSafeExternalHref(result?.url || part.args?.url || '')
  const fullTranscript = result?.transcript?.text?.trim() || ''
  const transcriptPreview = fullTranscript
    ? previewText(fullTranscript, showFullTranscript ? 4000 : 420)
    : undefined
  const canExpandTranscript = fullTranscript.length > 420
  const descriptionPreview = result?.description ? previewText(result.description, 280) : undefined
  const platform = platformLabel(result?.platform)
  const captionSource = result?.transcript?.source

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            {result?.errorCode && !result.transcript?.text && !result.title ? (
              <Text size="sm" c="var(--chatbox-tint-error)" m={0}>
                {previewText(result.errorMessage || result.errorCode) || t('Failed')}
              </Text>
            ) : null}

            {(result?.title || result?.author || platform || href) && (
              <div className="tool-video-meta">
                <div className="tool-video-meta-top">
                  {platform ? <span className="tool-video-platform">{platform}</span> : null}
                  {typeof result?.durationSec === 'number' ? (
                    <span className="tool-video-meta-stat tabular-nums">
                      {formatDurationForDisplay(result.durationSec)}
                    </span>
                  ) : null}
                  {captionSource ? (
                    <span className="tool-video-meta-stat">{captionSource}</span>
                  ) : null}
                  {result?.partial ? (
                    <span className="tool-video-meta-stat is-warn">{t('Partial')}</span>
                  ) : null}
                </div>
                {result?.title ? <p className="tool-video-title">{result.title}</p> : null}
                {result?.author ? (
                  <p className="tool-video-author">
                    {t('by {{name}}', { name: result.author })}
                  </p>
                ) : null}
                {href ? (
                  <a
                    className="tool-step-url tool-video-open"
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ScalableIcon icon={IconExternalLink} size={13} />
                    <span>{hostnameOf(href)}</span>
                  </a>
                ) : null}
              </div>
            )}

            {transcriptPreview ? (
              <div className="tool-video-transcript">
                <div className="tool-video-transcript-head">
                  <FieldLabel>{t('Captions')}</FieldLabel>
                  {result?.transcript?.language ? (
                    <span className="tool-video-meta-stat">{result.transcript.language}</span>
                  ) : null}
                </div>
                <div className="tool-step-content-preview tool-video-transcript-body">{transcriptPreview}</div>
                {canExpandTranscript ? (
                  <UnstyledButton
                    type="button"
                    className="tool-video-more"
                    onClick={(e) => {
                      e.stopPropagation()
                      setShowFullTranscript((v) => !v)
                    }}
                  >
                    {showFullTranscript ? t('Show less') : t('Show more')}
                  </UnstyledButton>
                ) : null}
              </div>
            ) : descriptionPreview ? (
              <div className="tool-video-transcript">
                <FieldLabel>{t('Description')}</FieldLabel>
                <div className="tool-step-content-preview">{descriptionPreview}</div>
                <Text size="xs" c="chatbox-tertiary" m={0}>
                  {t('No captions available — using video description instead.')}
                </Text>
              </div>
            ) : part.state === 'result' && !result?.errorCode ? (
              <Text size="sm" c="chatbox-secondary" m={0}>
                {t('No captions or description were available for this video.')}
              </Text>
            ) : null}

            {result?.warnings && result.warnings.length > 0 ? (
              <div className="tool-video-warnings">
                {result.warnings.map((w) => (
                  <span key={w} className="tool-video-warning-chip">
                    {previewText(w, 80)}
                  </span>
                ))}
              </div>
            ) : null}

            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Memory tools ─────────────────────────────────────────────────────────

type MemoryMatch = {
  id?: string
  scope?: string
  content?: string
  score?: number
  tags?: string[]
  pinned?: boolean
}

function parseMemoryResult(result: unknown): {
  matchCount: number
  matches: MemoryMatch[]
  note?: string
} {
  if (!result || typeof result !== 'object') {
    return { matchCount: 0, matches: [] }
  }
  const r = result as Record<string, unknown>
  const rawMatches = Array.isArray(r.matches) ? r.matches : Array.isArray(r.entries) ? r.entries : []
  const matches: MemoryMatch[] = rawMatches
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => ({
      id: typeof m.id === 'string' ? m.id : undefined,
      scope: typeof m.scope === 'string' ? m.scope : undefined,
      content: typeof m.content === 'string' ? m.content : typeof m.text === 'string' ? m.text : undefined,
      score: typeof m.score === 'number' ? m.score : undefined,
      tags: Array.isArray(m.tags) ? m.tags.filter((t): t is string => typeof t === 'string') : undefined,
      pinned: typeof m.pinned === 'boolean' ? m.pinned : undefined,
    }))
    .filter((m) => m.content)
  const matchCount =
    typeof r.matchCount === 'number' ? r.matchCount : typeof r.count === 'number' ? r.count : matches.length
  const note = typeof r.note === 'string' ? r.note : typeof r.message === 'string' ? r.message : undefined
  return { matchCount, matches, note }
}

function memorySummary(part: MessageToolCallPart, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (part.state === 'call') return t('Searching…')
  if (part.state === 'error') return t('Failed')
  const { matchCount, matches } = parseMemoryResult(part.result)
  const n = matchCount || matches.length
  if (n <= 0) return t('No matches')
  return n === 1 ? t('1 match') : t('{{count}} matches', { count: n })
}

const MemoryToolCallUI: FC<{ part: MessageToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const summary = useMemo(() => memorySummary(part, t), [part, t])
  const { matchCount, matches, note } = useMemo(() => parseMemoryResult(part.result), [part.result])
  const shown = matches.slice(0, 8)
  const extra = Math.max(0, (matchCount || matches.length) - shown.length)

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            {part.state === 'error' ? (
              <Text size="sm" c="var(--chatbox-tint-error)" m={0}>
                {previewText(part.result) || t('Failed')}
              </Text>
            ) : shown.length === 0 ? (
              <Text size="sm" c="chatbox-secondary" m={0}>
                {note || t('No matching memories for this message.')}
              </Text>
            ) : (
              <div className="tool-memory-list">
                {shown.map((m, i) => (
                  <div key={m.id || `mem-${i}`} className="tool-memory-card">
                    <div className="tool-memory-card-meta">
                      {m.scope ? (
                        <span className="tool-memory-scope">
                          {m.scope === 'agent' ? t('Agent') : t('Global')}
                        </span>
                      ) : null}
                      {m.pinned ? <span className="tool-memory-scope is-pinned">{t('Pinned')}</span> : null}
                      {typeof m.score === 'number' ? (
                        <span className="tool-memory-score tabular-nums">{Math.round(m.score * 100)}%</span>
                      ) : null}
                    </div>
                    <p className="tool-memory-content">{previewText(m.content, 280)}</p>
                    {m.tags && m.tags.length > 0 ? (
                      <div className="tool-memory-tags">
                        {m.tags.slice(0, 4).map((tag) => (
                          <span key={tag} className="tool-memory-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
                {extra > 0 ? (
                  <Text size="xs" c="chatbox-tertiary" m={0}>
                    {t('+{{count}} more', { count: extra })}
                  </Text>
                ) : null}
              </div>
            )}
            {note && shown.length > 0 ? (
              <Text size="xs" c="chatbox-tertiary" m={0} className="text-pretty">
                {note.includes('Host keyword')
                  ? t('Checked before other tools. Matches are also available to the model.')
                  : note}
              </Text>
            ) : null}
            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Generic tools ────────────────────────────────────────────────────────

function summarizeToolArgs(part: MessageToolCallPart, t: (k: string) => string): string | undefined {
  if (part.state === 'call') return t('Running…')
  if (part.state === 'error') return t('Failed')
  const args = part.args as Record<string, unknown> | undefined

  for (const key of ['query', 'path', 'file', 'name', 'command', 'url', 'id', 'credential_id']) {
    if (args?.[key] != null) {
      const v = previewText(args[key], 72)
      // Avoid full user messages / URLs as the only summary for long queries
      if (v.length >= 70 || /https?:\/\//i.test(v)) continue
      return v
    }
  }
  if (part.result != null && typeof part.result === 'object') {
    const r = part.result as Record<string, unknown>
    if (typeof r.message === 'string') return previewText(r.message, 72)
    if (typeof r.status === 'string') return previewText(r.status, 72)
  }
  if (part.result != null && typeof part.result !== 'object') {
    return previewText(part.result, 72)
  }
  return undefined
}

/** Optional account label for transparency (labels only — never tokens). */
function accountBadgeFromPart(part: MessageToolCallPart): string | undefined {
  const args = part.args as Record<string, unknown> | undefined
  const result = part.result as Record<string, unknown> | undefined
  const label =
    (typeof result?.usedAccountLabel === 'string' && result.usedAccountLabel) ||
    (typeof result?.accountLabel === 'string' && result.accountLabel) ||
    (typeof args?.accountLabel === 'string' && args.accountLabel)
  if (!label) return undefined
  return `via ${label}`
}

/** Prefer human fields over raw JSON dump for expanded generic tools. */
function humanResultLines(result: unknown): string[] {
  if (result == null) return []
  if (typeof result === 'string' || typeof result === 'number' || typeof result === 'boolean') {
    return [String(result)]
  }
  if (typeof result !== 'object') return []
  const r = result as Record<string, unknown>
  const lines: string[] = []
  for (const key of ['message', 'summary', 'text', 'content', 'output', 'stdout', 'error', 'status']) {
    if (typeof r[key] === 'string' && r[key].trim()) {
      lines.push(previewText(r[key], 400))
    }
  }
  return lines
}

const GeneralToolCallUI: FC<{ part: MessageToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)

  const summary = useMemo(() => summarizeToolArgs(part, t), [part, t])
  const badge = useMemo(() => accountBadgeFromPart(part), [part])
  const humanLines = useMemo(() => humanResultLines(part.result), [part.result])

  const argEntries = useMemo(() => {
    if (!part.args || typeof part.args !== 'object') return []
    // Hide noisy full-query args that duplicate the user message
    return Object.entries(part.args as Record<string, unknown>)
      .filter(([key, value]) => {
        if (key === 'query' || key === 'text' || key === 'content') {
          const s = typeof value === 'string' ? value : ''
          if (s.length > 80 || /https?:\/\//i.test(s)) return false
        }
        return true
      })
      .slice(0, 6)
  }, [part.args])

  return (
    <div className="tool-step">
      <ToolCallHeader
        toolName={part.toolName}
        state={part.state}
        summary={summary}
        badge={badge}
        runCount={runCount}
        expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      />
      <Collapse in={expanded}>
        <ToolStepBody>
          <Stack gap="sm">
            {argEntries.length > 0 && (
              <div className="tool-kv">
                {argEntries.map(([key, value]) => (
                  <div key={key} className="tool-kv-row">
                    <span className="tool-kv-key">{key}</span>
                    <span className="tool-kv-val">{previewText(value, 160)}</span>
                  </div>
                ))}
              </div>
            )}
            {part.state === 'error' && (
              <Text size="sm" c="var(--chatbox-tint-error)" m={0}>
                {previewText(part.result) || t('Failed')}
              </Text>
            )}
            {part.result != null && part.state !== 'error' && (
              <div>
                {humanLines.length > 0 ? (
                  <div className="tool-step-content-preview">
                    {humanLines.map((line, i) => (
                      <p key={i} className="tool-human-line">
                        {line}
                      </p>
                    ))}
                  </div>
                ) : (
                  <Text size="sm" c="chatbox-secondary" m={0}>
                    {t('Completed. Open technical details for raw output.')}
                  </Text>
                )}
              </div>
            )}
            <TechnicalDetails args={part.args} result={part.result} />
          </Stack>
        </ToolStepBody>
      </Collapse>
    </div>
  )
}

// ── Router ───────────────────────────────────────────────────────────────

export const ToolCallPartUI: FC<{ part: MessageToolCallPart; runCount?: number }> = ({ part, runCount }) => {
  // Task tools render as TodoAppCard (coalesced) — hide raw steps to avoid noise.
  if (isTaskTrackingTool(part.toolName)) {
    return null
  }
  if (part.toolName.startsWith('memory_')) {
    return <MemoryToolCallUI part={part} runCount={runCount} />
  }
  if (part.toolName === 'web_search') {
    const parsedPart = WebBrowsingToolCallPartSchema.safeParse(part)
    if (parsedPart.success) {
      return <WebSearchToolCallUI part={parsedPart.data as WebBrowsingToolCallPart} runCount={runCount} />
    }
  }
  if (part.toolName === 'parse_link') {
    return <ParseLinkToolCallUI part={part} runCount={runCount} />
  }
  if (part.toolName === 'read_video') {
    const parsedPart = ReadVideoToolCallPartSchema.safeParse(part)
    if (parsedPart.success) {
      return <ReadVideoToolCallUI part={parsedPart.data as ReadVideoToolCallPart} runCount={runCount} />
    }
  }
  if (part.toolName === 'read_video_url') {
    const parsedPart = ReadVideoUrlToolCallPartSchema.safeParse(part)
    if (parsedPart.success) {
      return <ReadVideoUrlToolCallUI part={parsedPart.data as ReadVideoUrlToolCallPart} runCount={runCount} />
    }
  }
  return <GeneralToolCallUI part={part} runCount={runCount} />
}

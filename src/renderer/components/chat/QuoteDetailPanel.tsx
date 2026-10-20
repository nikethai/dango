import { Box, Text } from '@mantine/core'
import type { MessageQuoteAttachment } from '@shared/types'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import Markdown, { BlockCodeCollapsedStateProvider } from '@/components/Markdown'
import { cn } from '@/lib/utils'
import { useSettingsStore } from '@/stores/settingsStore'

export function quoteRoleLabel(
  role: MessageQuoteAttachment['sourceRole'] | undefined,
  t: (key: string) => string
): string {
  switch (role) {
    case 'assistant':
      return t('Assistant')
    case 'user':
      return t('You')
    case 'system':
      return t('System')
    case 'tool':
      return t('Tool')
    default:
      return t('Message')
  }
}

export function quotePreviewText(text: string, maxLen = 36): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= maxLen) return collapsed
  return `${collapsed.slice(0, maxLen - 1)}…`
}

export type QuoteDetailPanelProps = {
  quote: Pick<MessageQuoteAttachment, 'text' | 'sourceRole' | 'isPartial'>
  className?: string
  compact?: boolean
}

/** High-contrast scrollable quote body for HoverCard / Popover / history. */
export function QuoteDetailPanel({ quote, className, compact }: QuoteDetailPanelProps) {
  const { t } = useTranslation()
  const markdownId = useId()
  const { enableMarkdownRendering, enableLaTeXRendering, enableMermaidRendering } = useSettingsStore((state) => state)
  const roleLabel = quoteRoleLabel(quote.sourceRole, t)
  const title = quote.isPartial ? t('Partial quote') : t('Quoted message')
  const lineCount = quote.text.length === 0 ? 0 : quote.text.split('\n').length

  return (
    <Box
      className={cn(
        'rounded-lg border border-solid border-[var(--chatbox-border-primary)] bg-[var(--chatbox-background-primary)] shadow-md',
        // Wider than a plain text tooltip so GFM tables / code fences stay readable
        compact ? 'w-full max-w-full' : 'w-[min(520px,calc(100vw-2rem))]',
        className
      )}
    >
      <div className="flex items-center justify-between gap-2 border-0 border-b border-solid border-[var(--chatbox-border-secondary)] px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-flex shrink-0 rounded-md bg-[var(--chatbox-background-brand-secondary)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--chatbox-tint-brand)]">
            {roleLabel}
          </span>
          <Text size="xs" className="truncate text-[var(--chatbox-tint-secondary)] font-medium">
            {title}
          </Text>
        </div>
        <Text size="xs" c="dimmed" className="shrink-0 tabular-nums">
          {lineCount} {lineCount === 1 ? t('line') : t('lines')}
        </Text>
      </div>
      <div
        className={cn(
          'overflow-y-auto overflow-x-auto px-3 py-2.5',
          'max-h-[min(360px,45vh)]',
          'border-0 border-l-[3px] border-solid border-[var(--chatbox-tint-brand)] ml-0',
          'bg-[var(--chatbox-background-secondary)]',
          // Reuse chat prose styles (.msg-content) so tables/code/lists match messages
          'msg-content quote-detail-markdown text-sm text-[var(--chatbox-tint-primary)]',
          '[&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs',
          '[&_th]:border [&_th]:border-[var(--chatbox-border-primary)] [&_th]:bg-[var(--chatbox-background-tertiary)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
          '[&_td]:border [&_td]:border-[var(--chatbox-border-primary)] [&_td]:px-2 [&_td]:py-1',
          '[&_pre]:my-2'
        )}
      >
        {enableMarkdownRendering ? (
          // Markdown code fences require this provider (same as MessageList)
          <BlockCodeCollapsedStateProvider defaultCollapsed>
            <Markdown
              uniqueId={`quote-preview-${markdownId}`}
              enableLaTeXRendering={enableLaTeXRendering}
              enableMermaidRendering={enableMermaidRendering}
              hiddenCodeCopyButton
              className="break-words"
            >
              {quote.text}
            </Markdown>
          </BlockCodeCollapsedStateProvider>
        ) : (
          <Text
            component="pre"
            size="sm"
            className="m-0 whitespace-pre-wrap break-words font-[family-name:var(--chatbox-font-sans)] leading-relaxed text-[var(--chatbox-tint-primary)]"
          >
            {quote.text}
          </Text>
        )}
      </div>
    </Box>
  )
}

export default QuoteDetailPanel

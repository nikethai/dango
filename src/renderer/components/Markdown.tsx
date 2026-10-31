import { sanitizeUrl } from '@braintree/sanitize-url'
import { useTheme } from '@mui/material/styles'
import { isRenderableCodeLanguage } from '@shared/artifacts'
import type { SearchCitation } from '@shared/types'
import {
  createContext,
  type ElementType,
  memo,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'
import rehypeKatex from 'rehype-katex'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import * as latex from '../packages/latex'
import 'katex/dist/katex.min.css' // `rehype-katex` does not import the CSS for you
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Loader, Text, Tooltip, useComputedColorScheme } from '@mantine/core'
import {
  IconBrandCpp,
  IconBrandCSharp,
  IconBrandCss3,
  IconBrandDocker,
  IconBrandGolang,
  IconBrandJavascript,
  IconBrandKotlin,
  IconBrandPhp,
  IconBrandPowershell,
  IconBrandPython,
  IconBrandReact,
  IconBrandRust,
  IconBrandSass,
  IconBrandSwift,
  IconBrandTypescript,
  IconBrandVue,
  IconCheck,
  IconChevronRight,
  IconCode,
  IconCopy,
  IconFileTypeCsv,
  IconFileTypeHtml,
  IconFileTypeSql,
  IconFileTypeSvg,
  IconFileTypeTxt,
  IconFileTypeXml,
  IconJson,
  IconPlayerPlayFilled,
  type IconProps,
  IconWorldUpload,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { visit } from 'unist-util-visit'
import { useCopied } from '@/hooks/useCopied'
import { nextFrozenMarkdownSplit } from '@/utils/split-streaming-markdown'
import { deployHtmlToEdgeOne } from '../packages/edgeone'
import * as toastActions from '../stores/toastActions'
import { ScalableIcon } from './common/ScalableIcon'
import IconDart from './icons/Dart'
import IconJava from './icons/Java'
import { MessageMermaid, SVGPreview } from './Mermaid'
import { CitationBadge } from './search/CitationBadge'

const CODE_BLOCK_COLLAPSE_LINE_THRESHOLD = 7

function remarkAddCodeIndex() {
  // biome-ignore lint/suspicious/noExplicitAny: remark AST nodes lack a friendly type here
  return (tree: any) => {
    let counter = 0
    visit(tree, 'code', (node) => {
      node.data = node.data || {}
      node.data.hProperties = node.data.hProperties || {}
      node.data.hProperties['data-code-index'] = counter++
    })
  }
}

function remarkTransformCitationLinks(citations: SearchCitation[]) {
  return () => {
    if (!citations?.length) {
      return
    }

    const citationIndexSet = new Set(citations.map((citation) => citation.index))

    // biome-ignore lint/suspicious/noExplicitAny: remark AST nodes lack a friendly type here
    return (tree: any) => {
      if (!tree || typeof tree !== 'object') {
        return
      }

      visit(tree, 'text', (node, index, parent) => {
        if (
          !parent ||
          !Array.isArray(parent.children) ||
          typeof index !== 'number' ||
          !node.value ||
          !citationIndexSet.size ||
          parent.type === 'link'
        ) {
          return
        }

        const parts = String(node.value).split(/(\[\d+\])/g)
        if (parts.length <= 1) {
          return
        }

        const replacementNodes: any[] = []
        for (const part of parts) {
          if (!part) {
            continue
          }
          const match = /^\[(\d+)\]$/.exec(part)
          if (!match) {
            replacementNodes.push({ type: 'text', value: part })
            continue
          }

          const citationIndex = Number(match[1])
          if (!citationIndexSet.has(citationIndex)) {
            replacementNodes.push({ type: 'text', value: part })
            continue
          }

          replacementNodes.push({
            type: 'link',
            url: `citation:${citationIndex}`,
            children: [{ type: 'text', value: part }],
          })
        }

        if (replacementNodes.length > 0) {
          parent.children.splice(index, 1, ...replacementNodes)
          return index + replacementNodes.length
        }
      })
    }
  }
}

type MarkdownProps = {
  children: string
  uniqueId?: string
  enableLaTeXRendering?: boolean
  enableMermaidRendering?: boolean
  hiddenCodeCopyButton?: boolean
  className?: string
  generating?: boolean
  forceColorScheme?: 'light' | 'dark'
  citations?: SearchCitation[]
}

function MarkdownCore(props: MarkdownProps) {
  const {
    children,
    uniqueId,
    enableLaTeXRendering = true,
    enableMermaidRendering = true,
    hiddenCodeCopyButton,
    generating,
    forceColorScheme,
    citations = [],
  } = props

  const codeFences = useMemo(() => (children.match(/```/g) || []).length, [children])
  const generatingCodeIndex = useMemo(() => (codeFences % 2 === 0 ? -1 : Math.floor(codeFences / 2)), [codeFences])
  const citationMap = useMemo(() => new Map(citations.map((citation) => [citation.index, citation])), [citations])

  return (
    <ReactMarkdown
      remarkPlugins={
        enableLaTeXRendering
          ? [remarkGfm, remarkMath, remarkBreaks, remarkAddCodeIndex, remarkTransformCitationLinks(citations)]
          : [remarkGfm, remarkBreaks, remarkAddCodeIndex, remarkTransformCitationLinks(citations)]
      }
      rehypePlugins={[rehypeKatex]}
      // No className here — the outer Markdown owns the single wrapper div, so a settled+tail
      // split renders as siblings in one container and block margins collapse like one parse.
      // react-markdown's default defaultUrlTransform will incorrectly encode query parameters in URLs (e.g. & becomes &amp;)
      // Use sanitizeUrl here to avoid that and to prevent XSS attacks
      urlTransform={(url) => sanitizeUrl(url)}
      components={useMemo(
        () => ({
          // biome-ignore lint/suspicious/noExplicitAny: react-markdown code component props are loosely typed
          code: (props: any) => {
            const codeIndex = typeof props['data-code-index'] === 'number' ? props['data-code-index'] : -1
            return (
              <CodeRenderer
                {...props}
                uniqueId={uniqueId ? `${uniqueId}-code-${codeIndex}` : undefined}
                hiddenCodeCopyButton={hiddenCodeCopyButton}
                enableMermaidRendering={enableMermaidRendering}
                generating={generating && generatingCodeIndex === codeIndex}
                forceColorScheme={forceColorScheme}
              />
            )
          },
          a: ({ node, ...props }) =>
            props.href?.startsWith('citation:') ? (
              (() => {
                const citationIndex = Number(props.href.replace('citation:', ''))
                const citation = citationMap.get(citationIndex)

                if (!citation) {
                  return <span>{props.children}</span>
                }

                return <CitationBadge citation={citation} />
              })()
            ) : (
              <a
                {...props}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => {
                  e.stopPropagation()
                }}
              />
            ),
        }),
        [
          citationMap,
          uniqueId,
          hiddenCodeCopyButton,
          enableMermaidRendering,
          generating,
          generatingCodeIndex,
          forceColorScheme,
        ]
      )}
    >
      {enableLaTeXRendering ? latex.processLaTeX(children) : children}
    </ReactMarkdown>
  )
}

// Settled blocks re-render only when their text changes (a new block completes), not on every
// token flush. Compare the render-affecting props; citations/uniqueId stay stable for a stream.
const MemoizedMarkdownCore = memo(
  MarkdownCore,
  (prev, next) =>
    prev.children === next.children &&
    prev.generating === next.generating &&
    prev.enableLaTeXRendering === next.enableLaTeXRendering &&
    prev.enableMermaidRendering === next.enableMermaidRendering &&
    prev.forceColorScheme === next.forceColorScheme
)

function Markdown(props: MarkdownProps) {
  const { children, className, generating, uniqueId, ...rest } = props
  const frozenRef = useRef<ReturnType<typeof nextFrozenMarkdownSplit>>(null)
  const uidRef = useRef(uniqueId)
  if (uidRef.current !== uniqueId) {
    uidRef.current = uniqueId
    frozenRef.current = null
  }
  frozenRef.current = nextFrozenMarkdownSplit(children, generating, frozenRef.current)
  const split = frozenRef.current
  // Single wrapper div (ReactMarkdown only wraps when handed a className, so we withhold it and
  // wrap here). Settled + tail stay mounted across generating→done so the answer does not remount.
  return (
    <div className={`break-words ${className || ''}`}>
      {split?.settled ? (
        <>
          <MemoizedMarkdownCore {...rest} uniqueId={uniqueId} generating={false}>
            {split.settled}
          </MemoizedMarkdownCore>
          <MarkdownCore
            {...rest}
            uniqueId={uniqueId ? `${uniqueId}-stream` : undefined}
            generating={Boolean(generating)}
          >
            {split.tail}
          </MarkdownCore>
        </>
      ) : (
        <MarkdownCore {...rest} uniqueId={uniqueId} generating={generating}>
          {children}
        </MarkdownCore>
      )}
    </div>
  )
}

export default memo(Markdown)

export const CodeRenderer = memo(
  (props: {
    children: string
    className?: string
    uniqueId?: string
    hiddenCodeCopyButton?: boolean
    generating?: boolean
    enableMermaidRendering?: boolean
    forceColorScheme?: 'light' | 'dark'
  }) => {
    const theme = useTheme()
    const { children, className, hiddenCodeCopyButton, generating, enableMermaidRendering, forceColorScheme } = props
    const language = /language-(\w+)/.exec(className || '')?.[1] || 'text'
    if (!String(children).includes('\n')) {
      return <InlineCode className={className}>{children}</InlineCode>
    }
    const source = String(children)
    const looksLikeMermaid =
      language === 'mermaid' ||
      ((language === 'text' || language === 'plaintext' || language === 'txt') && isLikelyMermaidSource(source))
    if (looksLikeMermaid && enableMermaidRendering) {
      return <MessageMermaid source={source} theme={theme.palette.mode} generating={generating} />
    }

    return (
      <>
        <BlockCode
          uniqueId={props.uniqueId}
          hiddenCodeCopyButton={hiddenCodeCopyButton}
          language={language}
          generating={generating}
          forceColorScheme={forceColorScheme}
        >
          {children}
        </BlockCode>
        {language === 'svg' ||
        (language === 'text' && String(children).startsWith('<svg')) ||
        (language === 'xml' && String(children).startsWith('<svg')) ||
        (language === 'html' && String(children).startsWith('<svg')) ? (
          <SVGPreview xmlCode={String(children)} className="max-w-sm" generating={generating} />
        ) : null}
      </>
    )
  }
)

const InlineCode = memo((props: { children: string; className?: string }) => {
  const { children, className } = props
  return (
    <code
      className={clsx(
        'bg-chatbox-background-secondary border border-solid border-chatbox-border-secondary rounded-sm px-1 py-0.5 mx-1',
        className
      )}
    >
      {children}
    </code>
  )
})

/** Detect mermaid when models omit the language fence tag. */
function isLikelyMermaidSource(source: string): boolean {
  const head = source.trimStart().slice(0, 120).toLowerCase()
  return /^(graph\b|flowchart\b|sequencediagram\b|classdiagram\b|statediagram\b|erdiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|gitgraph\b|c4context\b|xychart-beta\b|sankey-beta\b)/.test(
    head
  )
}

// Define the Context type
interface BlockCodeCollapsedStateContextType {
  collapsedStates: Record<string, boolean>
  toggleCollapse: (id: string) => void
  setCollapse: (id: string, collapsed: boolean) => void
  isCollapsed: (id: string) => boolean
  resetAll: () => void
}

// Create the Context
/**
 * Whether code blocks may offer "Publish Webpage". MessageList turns it off in chats that hold device-only text
 * (ADR 0016: nothing from such a chat leaves the device). Default on.
 */
export const CodePublishContext = createContext(true)

const BlockCodeCollapsedStateContext = createContext<BlockCodeCollapsedStateContextType | undefined>(undefined)

// Provider Props type
interface BlockCodeCollapsedStateProviderProps {
  children: ReactNode
  defaultCollapsed?: boolean // default collapsed state
}

// Provider component
export const BlockCodeCollapsedStateProvider: React.FC<BlockCodeCollapsedStateProviderProps> = ({
  children,
  defaultCollapsed = false,
}) => {
  const [collapsedStates, setCollapsedStates] = useState<Record<string, boolean>>({})

  // Toggle collapse state
  const toggleCollapse = useCallback(
    (id: string) => {
      setCollapsedStates((prev) => ({
        ...prev,
        [id]: typeof prev[id] === 'boolean' ? !prev[id] : !defaultCollapsed,
      }))
    },
    [defaultCollapsed]
  )

  // Set specific collapse state
  const setCollapse = useCallback((id: string, collapsed: boolean) => {
    setCollapsedStates((prev) => ({
      ...prev,
      [id]: collapsed,
    }))
  }, [])

  // Check if collapsed
  const isCollapsed = useCallback(
    (id: string) => collapsedStates[id] ?? defaultCollapsed,
    [collapsedStates, defaultCollapsed]
  )

  // Reset all states
  const resetAll = useCallback(() => {
    setCollapsedStates({})
  }, [])

  const value: BlockCodeCollapsedStateContextType = useMemo(
    () => ({
      collapsedStates,
      toggleCollapse,
      setCollapse,
      isCollapsed,
      resetAll,
    }),
    [collapsedStates, toggleCollapse, setCollapse, isCollapsed, resetAll]
  )

  return <BlockCodeCollapsedStateContext.Provider value={value}>{children}</BlockCodeCollapsedStateContext.Provider>
}

// Custom hook
export const useBlockCodeCollapsedState = (messageId: string) => {
  const context = useContext(BlockCodeCollapsedStateContext)

  if (context === undefined) {
    throw new Error('useBlockCodeCollapsedState must be used within a BlockCodeCollapsedStateProvider')
  }

  if (!messageId) {
    console.warn('useBlockCodeCollapsedState: messageId is empty, collapse state may not work correctly')
  }

  return {
    collapsed: context.isCollapsed(messageId),
    toggleCollapsed: () => context.toggleCollapse(messageId),
    setCollapsed: (collapsed: boolean) => context.setCollapse(messageId, collapsed),
  }
}

type BlockCodeProps = {
  language: string
  children: string
  uniqueId?: string
  hiddenCodeCopyButton?: boolean
  generating?: boolean
  forceColorScheme?: 'light' | 'dark'
}

const CodeIcons: { [key: string]: ElementType<IconProps> } = {
  HTML: IconFileTypeHtml,
  XML: IconFileTypeXml,
  JSON: IconJson,
  CSS: IconBrandCss3,
  SASS: IconBrandSass,
  SCSS: IconBrandSass,
  CSV: IconFileTypeCsv,
  SVG: IconFileTypeSvg,
  TEXT: IconFileTypeTxt,
  JAVASCRIPT: IconBrandJavascript,
  JS: IconBrandJavascript,
  TYPESCRIPT: IconBrandTypescript,
  TS: IconBrandTypescript,
  JSX: IconBrandReact,
  TSX: IconBrandReact,
  VUE: IconBrandVue,
  JAVA: IconJava,
  SWIFT: IconBrandSwift,
  KOTLIN: IconBrandKotlin,
  PYTHON: IconBrandPython,
  PY: IconBrandPython,
  PHP: IconBrandPhp,
  GO: IconBrandGolang,
  GOLANG: IconBrandGolang,
  CPP: IconBrandCpp,
  CSHARP: IconBrandCSharp,
  RUST: IconBrandRust,
  BASH: IconBrandPowershell,
  SHELL: IconBrandPowershell,
  POWERSHELL: IconBrandPowershell,
  SQL: IconFileTypeSql,
  MYSQL: IconFileTypeSql,
  DOCKER: IconBrandDocker,
  DOCKERFILE: IconBrandDocker,
  DART: IconDart,
}

const BlockCode = memo(
  ({ children, uniqueId, hiddenCodeCopyButton, language, generating, forceColorScheme }: BlockCodeProps) => {
    const { t } = useTranslation()
    const computedColorScheme = useComputedColorScheme()
    const colorScheme = forceColorScheme || computedColorScheme
    const languageName = useMemo(() => language.toUpperCase(), [language])
    const isRenderableCode = useMemo(() => isRenderableCodeLanguage(language), [language])
    const [deploying, setDeploying] = useState(false)
    const publishAllowed = useContext(CodePublishContext)
    const canDeploy = useMemo(
      () => publishAllowed && isRenderableCode && String(children).trim().length > 0,
      [children, isRenderableCode, publishAllowed]
    )

    const icon = useMemo(() => CodeIcons[languageName] || IconCode, [languageName])

    const { copied, copy } = useCopied(String(children))
    const onClickCopy = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation() // Avoid triggering parent select behavior in search window
        event.preventDefault()
        copy()
      },
      [copy]
    )
    const onClickArtifact = useCallback(
      (event: React.MouseEvent) => {
        event.stopPropagation() // Avoid triggering parent select behavior in search window
        event.preventDefault()
        NiceModal.show('artifact-preview', {
          htmlCode: String(children),
        }).catch(() => null)
      },
      [children]
    )

    const onClickDeploy = useCallback(
      async (event: React.MouseEvent) => {
        event.stopPropagation()
        event.preventDefault()
        if (!canDeploy) {
          return
        }
        // The upload goes to a third-party host, so it always asks first.
        if ((await NiceModal.show('publish-webpage-confirm')) !== true) {
          return
        }
        setDeploying(true)
        try {
          const url = await deployHtmlToEdgeOne(String(children))
          await NiceModal.show('edgeone-deploy-success', { url })
        } catch (error) {
          toastActions.add((error as Error)?.message || t('Publish failed'))
        } finally {
          setDeploying(false)
        }
      },
      [canDeploy, children, t]
    )

    const needCollapse = useMemo(
      () => !!uniqueId && children.split('\n').length > CODE_BLOCK_COLLAPSE_LINE_THRESHOLD,
      [uniqueId, children]
    )
    const { collapsed, toggleCollapsed } = useBlockCodeCollapsedState(uniqueId || '')
    const onClickCollapse = (event: React.MouseEvent) => {
      event.stopPropagation() // Avoid triggering parent select behavior in search window
      event.preventDefault()
      toggleCollapsed()
    }

    const actionsActive = copied || deploying

    return (
      <div className="code-fence my-2">
        <div className={clsx('code-fence-header', (!needCollapse || !collapsed) && 'is-sticky')}>
          <Flex align="center" gap={6} miw={0}>
            {generating ? (
              <Loader size={10} />
            ) : (
              <ScalableIcon size={14} icon={icon} color="var(--chatbox-tint-tertiary)" />
            )}
            <Text span className="code-fence-lang truncate">
              {languageName}
            </Text>
          </Flex>

          <div className={clsx('code-fence-actions', actionsActive && 'is-active')}>
            {!hiddenCodeCopyButton && (
              <Tooltip label={copied ? t('Copied') : t('Copy')} withArrow openDelay={400}>
                <ActionIcon
                  variant="subtle"
                  color={copied ? 'chatbox-success' : 'chatbox-tertiary'}
                  size={28}
                  radius="md"
                  className="active:scale-[0.96] transition-transform"
                  onClick={onClickCopy}
                  aria-label={t('Copy')}
                >
                  {copied ? <IconCheck size={15} stroke={1.75} /> : <IconCopy size={15} stroke={1.75} />}
                </ActionIcon>
              </Tooltip>
            )}

            {isRenderableCode && (
              <Tooltip label={t('Open as Artifact')} withArrow openDelay={400}>
                <ActionIcon
                  variant="subtle"
                  color="chatbox-tertiary"
                  size={28}
                  radius="md"
                  className="active:scale-[0.96] transition-transform"
                  onClick={onClickArtifact}
                  aria-label={t('Open as Artifact')}
                >
                  <IconPlayerPlayFilled size={14} />
                </ActionIcon>
              </Tooltip>
            )}

            {canDeploy && (
              <Tooltip label={t('Publish Webpage')} withArrow openDelay={400}>
                <ActionIcon
                  variant="subtle"
                  color="chatbox-tertiary"
                  size={28}
                  radius="md"
                  className="active:scale-[0.96] transition-transform"
                  onClick={onClickDeploy}
                  disabled={deploying}
                  aria-label={t('Publish Webpage')}
                >
                  {deploying ? <Loader size={12} /> : <IconWorldUpload size={15} stroke={1.75} />}
                </ActionIcon>
              </Tooltip>
            )}

            {needCollapse && (
              <Tooltip label={collapsed ? t('Expand') : t('Collapse')} withArrow openDelay={400}>
                <ActionIcon
                  variant="subtle"
                  color="chatbox-tertiary"
                  size={28}
                  radius="md"
                  onClick={onClickCollapse}
                  className={clsx('active:scale-[0.96] transition-transform', !collapsed && 'rotate-90')}
                  aria-label={collapsed ? t('Expand') : t('Collapse')}
                >
                  <IconChevronRight size={15} stroke={1.75} />
                </ActionIcon>
              </Tooltip>
            )}
          </div>
        </div>

        <div className={clsx('code-fence-body', needCollapse && collapsed && 'is-collapsed')}>
          {generating ? (
            // Plain mono while streaming — SyntaxHighlighter remount on every token was a height thrash source.
            <pre
              className="code-fence-streaming-pre"
              style={{
                margin: 0,
                padding: '0.75rem 0.85rem',
                fontSize: '0.8125rem',
                lineHeight: 1.55,
                fontFamily: 'var(--chatbox-font-mono)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                overflow: 'auto',
                ...(needCollapse && collapsed
                  ? {
                      maxHeight: '12rem',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'flex-end',
                    }
                  : {}),
              }}
            >
              {children}
            </pre>
          ) : (
            <SyntaxHighlighter
              style={colorScheme !== 'light' ? oneDark : oneLight}
              language={language}
              PreTag="div"
              showLineNumbers
              customStyle={{
                margin: 0,
                padding: '0.75rem 0.85rem',
                borderRadius: 0,
                border: 'none',
                background: 'transparent',
                fontSize: '0.8125rem',
                lineHeight: 1.55,
              }}
              lineNumberStyle={{
                minWidth: '2.25em',
                paddingRight: '0.85em',
                opacity: 0.45,
                fontVariantNumeric: 'tabular-nums',
              }}
              codeTagProps={{
                className: '!bg-transparent',
                style: { fontFamily: 'var(--chatbox-font-mono)' },
              }}
            >
              {children}
            </SyntaxHighlighter>
          )}
        </div>
      </div>
    )
  }
)

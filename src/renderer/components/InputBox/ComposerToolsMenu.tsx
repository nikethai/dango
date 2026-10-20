/**
 * Composer overflow — single + control for attach, tools, mode, session actions.
 * Click-primary (no hover-only). Model auto-uses tools; this is override + progressive disclosure.
 */

import { ActionIcon, Button, Flex, Menu, Modal, Switch, Text, TextInput, UnstyledButton } from '@mantine/core'
import type { KnowledgeBase } from '@shared/types'
import {
  IconAdjustmentsHorizontal,
  IconArrowBackUp,
  IconBrowser,
  IconCheck,
  IconDeviceDesktop,
  IconFile,
  IconFilePencil,
  IconFolder,
  IconLink,
  IconListCheck,
  IconPhoto,
  IconPlus,
  IconRobot,
  IconSettings2,
  IconUsersGroup,
  IconVocabulary,
  IconWorldWww,
  IconX,
} from '@tabler/icons-react'
import { Link } from '@tanstack/react-router'
import { type FC, type ReactNode, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Drawer } from 'vaul'
import { useKnowledgeBases } from '@/hooks/knowledge-base'
import { useMCPServerStatus, useToggleMCPServer } from '@/hooks/mcp'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import { BUILTIN_MCP_SERVERS } from '@/packages/mcp/builtin'
import { platformCapabilities } from '@/platform'
import { useMcpSettings } from '@/stores/settingsStore'
import { featureFlags } from '@/utils/feature-flags'
import { ScalableIcon } from '../common/ScalableIcon'
import MCPStatus from '../mcp/MCPStatus'
import { COMPOSER_TOOLBAR_ICON_CLASS, composerToolbarButtonClass } from './composerToolbar'

export type ComposerToolsMenuProps = {
  isOpenClawModel: boolean
  sessionType: string
  webBrowsingMode: boolean
  webSearchConfigured: boolean
  onWebBrowsingChange: (enabled: boolean) => void
  agentMode: boolean
  onToggleAgentMode?: () => void
  /** The chat's plan mode (`session.settings.planMode`); its row shows under Agent Mode in agent chats. */
  planMode?: boolean
  onPlanModeChange?: (on: boolean) => void
  /** False where plan mode does nothing though Agent Mode is on (multi-agent rooms). Default true. */
  showPlanMode?: boolean
  /** Absolute workspace path for agent file/terminal tools (desktop). */
  workspaceRoot?: string
  onWorkspaceRootChange?: (workspaceRoot: string | undefined) => void
  browserArmed?: boolean
  onBrowserArmedChange?: (armed: boolean) => void
  browserMasterEnabled?: boolean
  computerArmed?: boolean
  onComputerArmedChange?: (armed: boolean) => void
  computerMasterEnabled?: boolean
  knowledgeBaseId?: number
  onSelectKnowledgeBase?: (kb: KnowledgeBase | null) => void
  showRollbackThreadButton: boolean
  onStartNewThread?: () => void
  onRollbackThread?: () => void
  onClickSessionSettings?: () => void
  onShareRoomPack?: () => void
  /** The chat's Swarm switch (`session.roomMode === 'swarm'`). */
  swarmOn?: boolean
  /** Agents in the chat (or @-mentioned in the draft); the caption asks for more below two. */
  swarmAgentCount?: number
  /** Omit to hide the Swarm row. */
  onSwarmChange?: (on: boolean) => void
  onImageUploadClick: () => void
  onFileUploadClick: () => void
  onAttachLink: () => void
  toolbarButtonClass: string
  toolbarIconSize: number
  /**
   * Memory row inside overflow. Prefer a render prop so tools can close first
   * before Memory modal opens (avoids stacked menus on small desktop).
   */
  memorySlot?: ReactNode | ((api: { closeTools: () => void }) => ReactNode)
}

const ComposerToolsMenu: FC<ComposerToolsMenuProps> = ({
  isOpenClawModel,
  sessionType,
  webBrowsingMode,
  webSearchConfigured,
  onWebBrowsingChange,
  agentMode,
  onToggleAgentMode,
  planMode = false,
  onPlanModeChange,
  showPlanMode = true,
  workspaceRoot,
  onWorkspaceRootChange,
  browserArmed,
  onBrowserArmedChange,
  browserMasterEnabled,
  computerArmed,
  onComputerArmedChange,
  computerMasterEnabled,
  knowledgeBaseId,
  onSelectKnowledgeBase,
  showRollbackThreadButton,
  onStartNewThread,
  onRollbackThread,
  onClickSessionSettings,
  onShareRoomPack,
  swarmOn = false,
  swarmAgentCount = 0,
  onSwarmChange,
  onImageUploadClick,
  onFileUploadClick,
  onAttachLink,
  toolbarButtonClass,
  toolbarIconSize,
  memorySlot,
}) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [opened, setOpened] = useState(false)
  const closeTools = () => setOpened(false)
  const memoryNode = typeof memorySlot === 'function' ? memorySlot({ closeTools }) : memorySlot
  const [workspaceModalOpen, setWorkspaceModalOpen] = useState(false)
  const [workspaceDraft, setWorkspaceDraft] = useState(workspaceRoot ?? '')
  const mcp = useMcpSettings()
  const onMcpEnabledChange = useToggleMCPServer()
  const { data: knowledgeBases } = useKnowledgeBases()

  const mcpServers = mcp.servers.filter(
    (server) => platformCapabilities.supportsMcpStdio || server.transport.type !== 'stdio'
  )
  const mcpEnabledCount = mcpServers.filter((server) => server.enabled).length + mcp.enabledBuiltinServers.length
  const showMcp = featureFlags.mcp && !isOpenClawModel
  const showKb = featureFlags.knowledgeBase && !isOpenClawModel
  const showWeb = !isOpenClawModel
  const showAgent =
    sessionType === 'chat' &&
    !isOpenClawModel &&
    platformCapabilities.supportsDesktopOnlySettings &&
    Boolean(onToggleAgentMode)
  // Desktop Tauri builds use CHATBOX_BUILD_PLATFORM=unknown; web/android cannot write FS.
  const showWorkspace = showAgent && Boolean(onWorkspaceRootChange)
  // Plan mode is part of agent chats: hidden with Agent Mode off (the stored value is kept but does nothing).
  const showPlan = showAgent && agentMode && showPlanMode && Boolean(onPlanModeChange)
  const showBrowserArm = platformCapabilities.supportsDesktopOnlySettings && Boolean(onBrowserArmedChange)
  const showComputerArm = platformCapabilities.supportsDesktopOnlySettings && Boolean(onComputerArmedChange)
  // Swarm (rooms are native-only, so not for OpenClaw); not desktop-only.
  const showSwarm = sessionType === 'chat' && !isOpenClawModel && Boolean(onSwarmChange)

  useEffect(() => {
    if (workspaceModalOpen) {
      setWorkspaceDraft(workspaceRoot ?? '')
    }
  }, [workspaceModalOpen, workspaceRoot])

  const badgeActive = useMemo(() => {
    return (
      (!webBrowsingMode && webSearchConfigured) ||
      agentMode ||
      Boolean(workspaceRoot) ||
      Boolean(browserArmed) ||
      Boolean(computerArmed) ||
      (showSwarm && swarmOn) ||
      Boolean(knowledgeBaseId) ||
      (showMcp && mcpEnabledCount > 0)
    )
  }, [
    webBrowsingMode,
    webSearchConfigured,
    agentMode,
    workspaceRoot,
    browserArmed,
    computerArmed,
    showSwarm,
    swarmOn,
    knowledgeBaseId,
    showMcp,
    mcpEnabledCount,
  ])

  const workspaceLabel = useMemo(() => {
    if (!workspaceRoot) return null
    const parts = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean)
    return parts.at(-1) || workspaceRoot
  }, [workspaceRoot])

  const saveWorkspace = () => {
    setWorkspaceModalOpen(false)
    setOpened(false)
  }

  const plusButton = (
    <UnstyledButton
      className={cn(toolbarButtonClass, composerToolbarButtonClass(isSmallScreen))}
      aria-label={t('Tools and attachments')}
      aria-expanded={opened}
    >
      <IconPlus
        size={toolbarIconSize}
        strokeWidth={1.8}
        className={badgeActive ? 'text-[var(--chatbox-tint-brand)]' : COMPOSER_TOOLBAR_ICON_CLASS}
      />
      {badgeActive && (
        <span
          className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--chatbox-tint-brand)]"
          aria-hidden
        />
      )}
    </UnstyledButton>
  )

  const swarmRow = showSwarm ? (
    <Menu.Item
      leftSection={<IconUsersGroup size={16} stroke={1.5} />}
      closeMenuOnClick={false}
      rightSection={
        <Switch
          size="xs"
          checked={swarmOn}
          aria-label={t('Swarm')}
          onChange={(e) => onSwarmChange?.(e.currentTarget.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      }
      onClick={() => onSwarmChange?.(!swarmOn)}
    >
      <Flex direction="column" gap={2}>
        <Text size="sm">{t('Swarm')}</Text>
        <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>
          {swarmOn && swarmAgentCount < 2 ? t('Add 2 or 3 agents with @') : t('Several agents work on one answer')}
        </Text>
      </Flex>
    </Menu.Item>
  ) : null

  // Mode: Agent Mode, Plan mode under it, Project folder (agent chats), then Swarm. In both the drawer and the desktop menu.
  const modeSection =
    showAgent || showSwarm ? (
      <>
        <Menu.Divider />
        <Menu.Label fw={600}>{t('Mode')}</Menu.Label>
        {showAgent && (
          <Menu.Item
            leftSection={<IconRobot size={16} stroke={1.5} />}
            closeMenuOnClick={false}
            rightSection={
              <Switch
                size="xs"
                checked={agentMode}
                aria-label={t('Agent Mode')}
                onChange={() => onToggleAgentMode?.()}
                onClick={(e) => e.stopPropagation()}
              />
            }
            onClick={() => onToggleAgentMode?.()}
          >
            <Flex direction="column" gap={2}>
              <Text size="sm">{t('Agent Mode')}</Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>
                {t('Use tools and work in steps')}
              </Text>
            </Flex>
          </Menu.Item>
        )}
        {showPlan && (
          <Menu.Item
            leftSection={<IconListCheck size={16} stroke={1.5} />}
            closeMenuOnClick={false}
            rightSection={
              <Switch
                size="xs"
                checked={planMode}
                aria-label={t('Plan mode')}
                onChange={(e) => onPlanModeChange?.(e.currentTarget.checked)}
                onClick={(e) => e.stopPropagation()}
              />
            }
            onClick={() => onPlanModeChange?.(!planMode)}
          >
            <Flex direction="column" gap={2}>
              <Text size="sm">{t('Plan mode')}</Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }}>
                {t('Propose a plan first. Nothing runs until you choose Run plan.')}
              </Text>
            </Flex>
          </Menu.Item>
        )}
        {showWorkspace && (
          <Menu.Item
            leftSection={<IconFolder size={16} stroke={1.5} />}
            rightSection={
              workspaceRoot ? (
                <ActionIcon
                  size={18}
                  variant="subtle"
                  aria-label={t('Clear project folder')}
                  onClick={(e) => {
                    e.stopPropagation()
                    onWorkspaceRootChange?.(undefined)
                  }}
                >
                  <IconX size={12} />
                </ActionIcon>
              ) : null
            }
            onClick={() => {
              setWorkspaceModalOpen(true)
            }}
          >
            <Flex direction="column" gap={2}>
              <Text size="sm">{t('Project folder')}</Text>
              <Text size="xs" c="dimmed" style={{ lineHeight: 1.3 }} lineClamp={1}>
                {workspaceLabel ? workspaceLabel : t('Where the AI can read and edit files')}
              </Text>
            </Flex>
          </Menu.Item>
        )}
        {swarmRow}
      </>
    ) : null

  if (isSmallScreen) {
    return (
      <>
        <Drawer.Root open={opened} onOpenChange={setOpened} noBodyStyles>
          <Drawer.Trigger asChild>{plusButton}</Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 bg-chatbox-background-mask-overlay z-[390]" />
            <Drawer.Content className="composer-tools-sheet flex flex-col fixed bottom-0 left-0 right-0 outline-none bg-chatbox-background-primary rounded-t-2xl max-h-[72dvh] overflow-hidden z-[400]">
              <Drawer.Handle />
              <Text c="chatbox-tertiary" size="xs" className="text-center my-xxs" fw={600}>
                {t('Tools and attachments')}
              </Text>
              <Menu opened onChange={() => undefined} closeOnItemClick={false} withinPortal={false}>
                <Menu.Target>
                  <span className="sr-only" />
                </Menu.Target>
                <Menu.Dropdown className="composer-tools-menu !relative !inset-auto !shadow-none !border-0 !w-full !max-h-none overflow-y-auto pb-[max(0.75rem,var(--mobile-safe-area-inset-bottom,env(safe-area-inset-bottom)))]">
                  <Menu.Label fw={600}>{t('Attach')}</Menu.Label>
                  <Menu.Item
                    leftSection={<IconPhoto size={16} stroke={1.5} />}
                    onClick={() => {
                      onImageUploadClick()
                      setOpened(false)
                    }}
                  >
                    {t('Image')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconFolder size={16} stroke={1.5} />}
                    onClick={() => {
                      onFileUploadClick()
                      setOpened(false)
                    }}
                  >
                    {t('File')}
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconLink size={16} stroke={1.5} />}
                    onClick={() => {
                      onAttachLink()
                      setOpened(false)
                    }}
                  >
                    {t('Link')}
                  </Menu.Item>

                  {memoryNode ? (
                    <>
                      <Menu.Divider />
                      <Menu.Label fw={600}>{t('Memory')}</Menu.Label>
                      <div className="composer-tools-memory-slot px-1 pb-1">{memoryNode}</div>
                    </>
                  ) : null}

                  {(showWeb || showMcp || showKb) && (
                    <>
                      <Menu.Divider />
                      <Menu.Label fw={600}>{t('Tools')}</Menu.Label>
                    </>
                  )}

                  {showWeb && (
                    <Menu.Item
                      leftSection={<IconWorldWww size={16} stroke={1.5} />}
                      closeMenuOnClick={false}
                      disabled={!webSearchConfigured && !webBrowsingMode}
                      rightSection={
                        <Switch
                          size="xs"
                          checked={webBrowsingMode}
                          disabled={!webSearchConfigured && !webBrowsingMode}
                          onChange={(e) => onWebBrowsingChange(e.currentTarget.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      }
                      onClick={() => {
                        if (webSearchConfigured || webBrowsingMode) {
                          onWebBrowsingChange(!webBrowsingMode)
                        }
                      }}
                    >
                      <Flex direction="column" gap={2}>
                        <Text size="sm">{t('Web Search')}</Text>
                        {!webSearchConfigured && (
                          <Text size="xs" c="dimmed">
                            {t('Configure in Settings')}
                          </Text>
                        )}
                      </Flex>
                    </Menu.Item>
                  )}

                  {showBrowserArm && (
                    <Menu.Item
                      leftSection={<IconBrowser size={16} stroke={1.5} />}
                      closeMenuOnClick={false}
                      disabled={!browserMasterEnabled}
                      rightSection={
                        <Switch
                          size="xs"
                          checked={Boolean(browserArmed)}
                          disabled={!browserMasterEnabled}
                          onChange={(e) => onBrowserArmedChange?.(e.currentTarget.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      }
                      onClick={() => {
                        if (browserMasterEnabled) onBrowserArmedChange?.(!browserArmed)
                      }}
                    >
                      <Flex direction="column" gap={2}>
                        <Text size="sm">{t('Dango Browser')}</Text>
                        <Text size="xs" c="dimmed">
                          {browserMasterEnabled
                            ? t('Isolated browser (not your personal Chrome)')
                            : t('Enable in Settings → Browser Agent')}
                        </Text>
                      </Flex>
                    </Menu.Item>
                  )}

                  {showComputerArm && (
                    <Menu.Item
                      leftSection={<IconDeviceDesktop size={16} stroke={1.5} />}
                      closeMenuOnClick={false}
                      disabled={!computerMasterEnabled}
                      rightSection={
                        <Switch
                          size="xs"
                          checked={Boolean(computerArmed)}
                          disabled={!computerMasterEnabled}
                          onChange={(e) => onComputerArmedChange?.(e.currentTarget.checked)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      }
                      onClick={() => {
                        if (computerMasterEnabled) onComputerArmedChange?.(!computerArmed)
                      }}
                    >
                      <Flex direction="column" gap={2}>
                        <Text size="sm">{t('Computer Use')}</Text>
                        <Text size="xs" c="dimmed">
                          {computerMasterEnabled
                            ? t('Screen observe / act with approvals')
                            : t('Enable in Settings → Computer Use')}
                        </Text>
                      </Flex>
                    </Menu.Item>
                  )}

                  {showMcp && (
                    <>
                      <Flex justify="space-between" align="center" px="sm" pt="xs">
                        <Text size="xs" fw={600} c="dimmed" style={{ letterSpacing: '-0.01em' }}>
                          {t('Extensions')}
                          {mcpEnabledCount > 0 ? ` · ${mcpEnabledCount}` : ''}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          size={22}
                          onClick={() => {
                            setOpened(false)
                            navigateToSettings('/mcp')
                          }}
                          aria-label={t('Extension settings')}
                        >
                          <ScalableIcon icon={IconSettings2} size={14} color="var(--chatbox-tint-tertiary)" />
                        </ActionIcon>
                      </Flex>
                      {BUILTIN_MCP_SERVERS.map((server) => (
                        <McpServerRow
                          key={server.id}
                          id={server.id}
                          name={server.name}
                          enabled={mcp.enabledBuiltinServers.includes(server.id)}
                          onEnabledChange={onMcpEnabledChange}
                        />
                      ))}
                      {mcpServers.map((server) => (
                        <McpServerRow
                          key={server.id}
                          id={server.id}
                          name={server.name}
                          enabled={server.enabled}
                          onEnabledChange={onMcpEnabledChange}
                        />
                      ))}
                      {!mcpServers.length && !mcp.enabledBuiltinServers.length && (
                        <Menu.Item component={Link} to="/settings/mcp" onClick={() => setOpened(false)}>
                          {t('Connect an extension')}
                        </Menu.Item>
                      )}
                    </>
                  )}

                  {showKb && (
                    <>
                      <Flex justify="space-between" align="center" px="sm" pt="xs">
                        <Text size="xs" fw={600} c="dimmed" style={{ letterSpacing: '-0.01em' }}>
                          {t('Knowledge')}
                        </Text>
                        <ActionIcon
                          variant="subtle"
                          size={22}
                          component={Link}
                          to="/settings/knowledge-base"
                          onClick={() => setOpened(false)}
                          aria-label={t('Knowledge Base Settings')}
                        >
                          <ScalableIcon icon={IconVocabulary} size={14} color="var(--chatbox-tint-tertiary)" />
                        </ActionIcon>
                      </Flex>
                      {knowledgeBases?.map((kb) => (
                        <Menu.Item
                          key={kb.id}
                          leftSection={<IconFile size={14} stroke={1.5} />}
                          rightSection={
                            kb.id === knowledgeBaseId ? <IconCheck size={14} color="var(--chatbox-tint-brand)" /> : null
                          }
                          onClick={() => {
                            if (kb.id === knowledgeBaseId) {
                              onSelectKnowledgeBase?.(null)
                            } else {
                              onSelectKnowledgeBase?.(kb)
                            }
                          }}
                        >
                          <Text size="sm" c={kb.id === knowledgeBaseId ? 'chatbox-brand' : undefined}>
                            {kb.name}
                          </Text>
                        </Menu.Item>
                      ))}
                      {knowledgeBases?.length === 0 && (
                        <Menu.Item component={Link} to="/settings/knowledge-base" onClick={() => setOpened(false)}>
                          {t('Create')}
                        </Menu.Item>
                      )}
                      {knowledgeBaseId != null && (
                        <Menu.Item onClick={() => onSelectKnowledgeBase?.(null)}>{t('Clear selection')}</Menu.Item>
                      )}
                    </>
                  )}

                  {modeSection}

                  <Menu.Divider />
                  <Menu.Label fw={600}>{t('Chat')}</Menu.Label>
                  {showRollbackThreadButton ? (
                    <Menu.Item
                      leftSection={<IconArrowBackUp size={16} stroke={1.5} />}
                      onClick={() => {
                        onRollbackThread?.()
                        setOpened(false)
                      }}
                    >
                      {t('Undo last reply')}
                    </Menu.Item>
                  ) : (
                    <Menu.Item
                      leftSection={<IconFilePencil size={16} stroke={1.5} />}
                      disabled={!onStartNewThread}
                      onClick={() => {
                        onStartNewThread?.()
                        setOpened(false)
                      }}
                    >
                      {t('New Thread')}
                    </Menu.Item>
                  )}
                  <Menu.Item
                    leftSection={<IconAdjustmentsHorizontal size={16} stroke={1.5} />}
                    disabled={!onClickSessionSettings}
                    onClick={() => {
                      onClickSessionSettings?.()
                      setOpened(false)
                    }}
                  >
                    {t('Chat settings')}
                  </Menu.Item>
                  {onShareRoomPack && (
                    <Menu.Item
                      leftSection={<IconFile size={16} stroke={1.5} />}
                      onClick={() => {
                        onShareRoomPack()
                        setOpened(false)
                      }}
                    >
                      {t('Share room pack')}
                    </Menu.Item>
                  )}
                </Menu.Dropdown>
              </Menu>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
        <Modal
          opened={workspaceModalOpen}
          onClose={() => setWorkspaceModalOpen(false)}
          title={t('Project folder')}
          centered
          size="md"
        >
          <Flex direction="column" gap="sm">
            <Text size="sm" c="dimmed">
              {t(
                'Choose a folder from the Scopes rail using the system folder picker. Pasted absolute paths cannot authorize access. Generic project shell is unavailable.'
              )}
            </Text>
            <Flex justify="flex-end" gap="xs" mt="xs">
              <Button variant="default" onClick={() => setWorkspaceModalOpen(false)}>
                {t('Close')}
              </Button>
            </Flex>
          </Flex>
        </Modal>
      </>
    )
  }

  return (
    <>
      <Menu
        opened={opened}
        onChange={setOpened}
        trigger="click"
        position="top-start"
        shadow="md"
        width={280}
        closeOnItemClick={false}
        withinPortal
        middlewares={{ flip: true, shift: true, inline: false }}
        transitionProps={{ transition: 'pop', duration: 160 }}
      >
        <Menu.Target>{plusButton}</Menu.Target>
        <Menu.Dropdown className="composer-tools-menu">
          <Menu.Label fw={600}>{t('Attach')}</Menu.Label>
          <Menu.Item
            leftSection={<IconPhoto size={16} stroke={1.5} />}
            onClick={() => {
              onImageUploadClick()
              setOpened(false)
            }}
          >
            {t('Image')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconFolder size={16} stroke={1.5} />}
            onClick={() => {
              onFileUploadClick()
              setOpened(false)
            }}
          >
            {t('File')}
          </Menu.Item>
          <Menu.Item
            leftSection={<IconLink size={16} stroke={1.5} />}
            onClick={() => {
              onAttachLink()
              setOpened(false)
            }}
          >
            {t('Link')}
          </Menu.Item>
          {memoryNode ? (
            <>
              <Menu.Divider />
              <Menu.Label fw={600}>{t('Memory')}</Menu.Label>
              <div className="composer-tools-memory-slot px-1 pb-1">{memoryNode}</div>
            </>
          ) : null}
          {(showWeb || showMcp || showKb) && (
            <>
              <Menu.Divider />
              <Menu.Label fw={600}>{t('Tools')}</Menu.Label>
            </>
          )}
          {showWeb && (
            <Menu.Item
              leftSection={<IconWorldWww size={16} stroke={1.5} />}
              closeMenuOnClick={false}
              disabled={!webSearchConfigured && !webBrowsingMode}
              rightSection={
                <Switch
                  size="xs"
                  checked={webBrowsingMode}
                  disabled={!webSearchConfigured && !webBrowsingMode}
                  onChange={(e) => onWebBrowsingChange(e.currentTarget.checked)}
                  onClick={(e) => e.stopPropagation()}
                />
              }
              onClick={() => {
                if (webSearchConfigured || webBrowsingMode) {
                  onWebBrowsingChange(!webBrowsingMode)
                }
              }}
            >
              <Flex direction="column" gap={2}>
                <Text size="sm">{t('Web Search')}</Text>
                {!webSearchConfigured && (
                  <Text size="xs" c="dimmed">
                    {t('Configure in Settings')}
                  </Text>
                )}
              </Flex>
            </Menu.Item>
          )}
          {modeSection}
          <Menu.Divider />
          <Menu.Label fw={600}>{t('Chat')}</Menu.Label>
          {showRollbackThreadButton ? (
            <Menu.Item
              leftSection={<IconArrowBackUp size={16} stroke={1.5} />}
              onClick={() => {
                onRollbackThread?.()
                setOpened(false)
              }}
            >
              {t('Undo last reply')}
            </Menu.Item>
          ) : (
            <Menu.Item
              leftSection={<IconFilePencil size={16} stroke={1.5} />}
              disabled={!onStartNewThread}
              onClick={() => {
                onStartNewThread?.()
                setOpened(false)
              }}
            >
              {t('New Thread')}
            </Menu.Item>
          )}
          <Menu.Item
            leftSection={<IconAdjustmentsHorizontal size={16} stroke={1.5} />}
            disabled={!onClickSessionSettings}
            onClick={() => {
              onClickSessionSettings?.()
              setOpened(false)
            }}
          >
            {t('Chat settings')}
          </Menu.Item>
          {onShareRoomPack && (
            <Menu.Item
              leftSection={<IconFile size={16} stroke={1.5} />}
              onClick={() => {
                onShareRoomPack()
                setOpened(false)
              }}
            >
              {t('Share room pack')}
            </Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>
      <Modal
        opened={workspaceModalOpen}
        onClose={() => setWorkspaceModalOpen(false)}
        title={t('Project folder')}
        centered
        size="md"
      >
        <Flex direction="column" gap="sm">
          <Text size="sm" c="dimmed">
            {t(
              'Choose a folder from the Scopes rail using the system folder picker. Pasted absolute paths cannot authorize access. Generic project shell is unavailable.'
            )}
          </Text>
          <Flex justify="flex-end" gap="xs" mt="xs">
            <Button variant="default" onClick={() => setWorkspaceModalOpen(false)}>
              {t('Close')}
            </Button>
          </Flex>
        </Flex>
      </Modal>
    </>
  )
}

const McpServerRow: FC<{
  id: string
  name: string
  enabled: boolean
  onEnabledChange: (id: string, enabled: boolean) => void
}> = ({ id, name, enabled, onEnabledChange }) => {
  const status = useMCPServerStatus(id)
  return (
    <Menu.Item
      closeMenuOnClick={false}
      leftSection={<MCPStatus status={status} />}
      rightSection={
        <Switch
          size="xs"
          checked={enabled}
          disabled={status?.state === 'starting' || status?.state === 'stopping'}
          onChange={(e) => onEnabledChange(id, e.currentTarget.checked)}
          onClick={(e) => e.stopPropagation()}
        />
      }
      onClick={() => {
        if (status?.state !== 'starting' && status?.state !== 'stopping') {
          onEnabledChange(id, !enabled)
        }
      }}
    >
      {name}
    </Menu.Item>
  )
}

export default ComposerToolsMenu

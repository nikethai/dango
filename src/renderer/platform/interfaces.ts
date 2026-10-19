/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */
import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import type {
  WorkspaceDescriptor,
  WorkspaceListResult,
  WorkspaceMutationResult,
  WorkspaceReadResult,
  WorkspaceSearchHit,
  WorkspaceTrustCategory,
  WorkspaceTrustValue,
} from '@shared/types/workspace'
import type { TrayStatus } from '@/packages/menu-bar/tray-status'
import type { ImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type { KnowledgeBaseController } from './knowledge-base/interface'

export type PlatformType = 'web' | 'desktop' | 'mobile'

export type FormFactor = 'desktop' | 'mobile'

export interface Storage {
  getStorageType(): string
  setStoreValue(key: string, value: any): Promise<void>
  getStoreValue(key: string): Promise<any>
  delStoreValue(key: string): Promise<void>
  getAllStoreValues(): Promise<{ [key: string]: any }>
  getAllStoreKeys(): Promise<string[]>
  setAllStoreValues(data: { [key: string]: any }): Promise<void>
}

export interface Platform extends Storage {
  type: PlatformType
  formFactor: FormFactor

  exporter: Exporter

  // (legacy comment removed)

  getVersion(): Promise<string>
  getPlatform(): Promise<string>
  getArch(): Promise<string>
  shouldUseDarkColors(): Promise<boolean>
  onSystemThemeChange(callback: () => void): () => void
  onWindowShow(callback: () => void): () => void
  onWindowFocused(callback: () => void): () => void
  onUpdateDownloaded(callback: () => void): () => void
  onNavigate?(callback: (path: string) => void): () => void
  openLink(url: string): Promise<void>
  getDeviceName(): Promise<string>
  getInstanceName(): Promise<string>
  getLocale(): Promise<Language>
  ensureShortcutConfig(config: ShortcutSetting): Promise<void>
  ensureProxyConfig(config: { proxy?: string }): Promise<void>
  relaunch(): Promise<void>

  // (legacy comment removed)

  getConfig(): Promise<Config>
  getSettings(): Promise<Settings>

  // Blob

  getStoreBlob(key: string): Promise<string | null>
  setStoreBlob(key: string, value: string): Promise<void>
  delStoreBlob(key: string): Promise<void>
  listStoreBlobKeys(): Promise<string[]>

  // (legacy comment removed)

  initTracking(): void
  trackingEvent(name: string, params: { [key: string]: string }): void

  // (legacy comment removed)
  shouldShowAboutDialogWhenStartUp(): Promise<boolean>

  appLog(level: string, message: string): Promise<void>

  // (legacy comment removed)
  exportLogs(): Promise<string> // (legacy)
  clearLogs(): Promise<void> // (legacy)

  ensureAutoLaunch(enable: boolean): Promise<void>

  parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }>

  /** Desktop: native ZIP file picker. Returns a filesystem path or null if cancelled. */
  pickImportedArchivePath?(): Promise<string | null>
  /** Desktop: inspect a ChatGPT export ZIP at a filesystem path. */
  inspectImportedArchive?(path: string): Promise<unknown>

  // Parse file using MinerU service (Desktop only)
  parseFileWithMineru?(
    file: File,
    apiToken: string
  ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }>

  // Cancel MinerU parsing task (Desktop only)
  cancelMineruParse?(filePath: string): Promise<{ success: boolean; error?: string }>

  // parseUrl(url: string): Promise<{ key: string, title: string }>

  isFullscreen(): Promise<boolean>
  setFullscreen(enabled: boolean): Promise<void>
  installUpdate(): Promise<void>

  getKnowledgeBaseController(): KnowledgeBaseController

  getImageGenerationStorage(): ImageGenerationStorage

  // Broad filesystem operations are unavailable. Use workspace capability APIs.

  readFileByPath(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
  deleteFile(path: string): Promise<void>

  /** Native picker-owned bind. Never accepts a renderer path. */
  pickAndBindProject?(projectId: string): Promise<WorkspaceDescriptor | null>
  restoreProjectBinding?(projectId: string): Promise<WorkspaceDescriptor>
  revokeProjectBinding?(projectId: string): Promise<void>
  relinkProject?(projectId: string): Promise<WorkspaceDescriptor | null>
  unbindProject?(projectId: string): Promise<void>
  revealProject?(projectId: string): Promise<void>
  readWorkspaceFile?(capabilityId: string, relativePath: string): Promise<WorkspaceReadResult>
  listWorkspaceChildren?(
    capabilityId: string,
    relativePath: string,
    cursor?: string,
    requestId?: string
  ): Promise<WorkspaceListResult>
  searchWorkspace?(
    capabilityId: string,
    query: string,
    requestId?: string
  ): Promise<{ hits: WorkspaceSearchHit[]; requestId?: string }>
  cancelWorkspaceRequest?(requestId: string): Promise<void>
  createWorkspaceFile?(
    capabilityId: string,
    relativePath: string,
    content: string,
    mode: 'create' | 'overwrite',
    expectedRevision?: string
  ): Promise<WorkspaceMutationResult>
  editWorkspaceFile?(
    capabilityId: string,
    relativePath: string,
    oldString: string,
    newString: string,
    expectedRevision: string
  ): Promise<WorkspaceMutationResult>
  deleteWorkspaceFile?(
    capabilityId: string,
    relativePath: string,
    expectedRevision: string
  ): Promise<WorkspaceMutationResult>
  setProjectTrust?(projectId: string, category: WorkspaceTrustCategory, value: WorkspaceTrustValue): Promise<void>
  getWorkspaceSuiteCapabilities?(): Promise<unknown>
  beginWorkspaceChangeSet?(capabilityId: string, sessionId: string, turnId: string): Promise<{ changeSetId: string }>
  appendWorkspaceChange?(
    changeSetId: string,
    operation: Record<string, unknown>
  ): Promise<{ operationId?: string; staged?: boolean }>
  sealWorkspaceChangeSet?(changeSetId: string): Promise<{ digest?: string; operations?: unknown[] }>
  getWorkspaceChangeSet?(changeSetId: string): Promise<unknown>
  discardWorkspaceChangeSet?(changeSetId: string): Promise<unknown>
  preflightWorkspaceChangeSet?(changeSetId: string, digest: string, selectedIds: string[]): Promise<{ ok?: boolean }>
  prepareWorkspaceApply?(changeSetId: string, digest: string, selectedIds: string[]): Promise<{ applyTicket?: string }>
  applyWorkspaceChangeSet?(applyTicket: string): Promise<{ status?: string }>
  prepareWorkspaceExport?(capabilityId: string, selection: Record<string, unknown>): Promise<unknown>
  prepareAppArtifactExport?(artifactId: string): Promise<unknown>
  exportWorkspace?(manifestId: string): Promise<{ status?: string }>
  discardWorkspaceExport?(manifestId: string): Promise<unknown>
  getSourceControlStatus?(capabilityId: string): Promise<unknown>
  getSourceControlDiff?(capabilityId: string, changeId?: string): Promise<unknown>
  getSourceControlLog?(capabilityId: string, limit?: number): Promise<unknown>
  getLocalExecutionStatus?(): Promise<unknown>
  getManagedWorktreeStatus?(): Promise<unknown>
  readCodexAuthConfig?(): Promise<string>
  videoYtDlp?(op: 'detect' | 'install'): Promise<unknown>
  /** Test-only: never a renderer authorization path. */
  __testBindProjectFolder?(projectId: string, folderPath: string): Promise<WorkspaceDescriptor>

  // window controls
  minimize(): Promise<void>

  maximize(): Promise<void>

  unmaximize(): Promise<void>

  closeWindow(): Promise<void>

  isMaximized(): Promise<boolean>

  onMaximizedChange(callback: (isMaximized: boolean) => void): () => void

  // Desktop shell (tray / quick window / screenshot) — desktop only
  setKeepInTray?(enabled: boolean): Promise<void>
  setQuickWindowAlwaysOnTop?(enabled: boolean): Promise<void>
  showQuickWindow?(): Promise<void>
  /** Hide the quick window (desktop shell only; absent on web/mobile). */
  hideQuickWindow?(): Promise<void>
  /** Resize the quick window to this height in logical px; the shell clamps to 112–640 and keeps the 620 px width. */
  setQuickWindowHeight?(px: number): Promise<void>
  showMainWindow?(): Promise<void>
  openSessionInMain?(sessionId: string): Promise<void>
  /**
   * Hide the quick window, show the main window and route it to `path` (an app path starting with `/`, e.g.
   * `/settings/provider`). Desktop shell only; absent on web/mobile, where callers navigate their own window.
   */
  openInMain?(path: string): Promise<void>
  captureScreenshotRegion?(): Promise<ScreenshotImagePayload | null>
  readClipboardImage?(): Promise<ScreenshotImagePayload | null>
  notifyQuickRendererReady?(): Promise<void>
  notifyQuickRendererGone?(): Promise<void>
  getWindowLabel?(): Promise<string>
  onQuickShown?(callback: () => void): () => void
  onShellNavigate?(callback: (path: string) => void): () => void
  onScreenshotCaptured?(callback: (payload: ScreenshotImagePayload) => void): () => void
  onClipboardCaptured?(callback: (payload: ClipboardCapturePayload) => void): () => void
  onScreenshotError?(callback: (message: string) => void): () => void
  onHiddenToTray?(callback: () => void): () => void
  /** Push the menu bar / tray status to the native shell (desktop shell only; absent elsewhere). */
  setTrayStatus?(status: TrayStatus): Promise<void>
  /** The tray's Pause / Resume row was clicked (`shell:tray-pause-toggle`). */
  onTrayPauseToggle?(callback: () => void): () => void

  // Terminal command execution (Desktop only)
  executeCommand?(
    command: string,
    cwd?: string,
    timeoutMs?: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>

  // Agent browser (Desktop only) — isolated Chromium via Playwright host
  browserSessionStart?(opts: BrowserSessionStartPayload): Promise<unknown>
  browserSessionStop?(sessionId: string): Promise<unknown>
  browserSessionStatus?(sessionId: string): Promise<BrowserStatusPayload>
  browserSessionWipe?(sessionId: string): Promise<unknown>
  browserNavigate?(sessionId: string, url: string): Promise<unknown>
  browserSnapshot?(sessionId: string, opts?: { interestingOnly?: boolean }): Promise<BrowserSnapshotPayload>
  browserAct?(sessionId: string, action: BrowserActPayload): Promise<unknown>
  browserTabs?(sessionId: string, op: BrowserTabsPayload): Promise<unknown>
  browserScreenshot?(sessionId: string): Promise<BrowserScreenshotPayload>

  // Computer use (Desktop only)
  computerListDisplays?(): Promise<{ displays: Array<{ id: string; name: string; isPrimary?: boolean }> }>
  computerPermissionStatus?(): Promise<ComputerPermissionStatus>
  /** macOS: may show Screen Recording system prompt; returns updated status. */
  computerPermissionRequest?(): Promise<ComputerPermissionStatus>
  /** Reveal the running binary in Finder/Explorer (needed for + in Privacy lists in dev). */
  computerRevealExecutable?(): Promise<{ ok: boolean; executablePath?: string }>
  computerOpenApp?(opts: { name: string }): Promise<{
    ok?: boolean
    name?: string
    backend?: string
    activated?: boolean
    frontmost?: string
    note?: string
  }>
  /** Open URI scheme / URL (whatsapp://, https://, sms:). Desktop only. */
  computerOpenUri?(opts: { uri: string }): Promise<{
    ok?: boolean
    uri?: string
    scheme?: string
    frontmost?: string
    backend?: string
    note?: string
    error?: string
  }>
  /** Best-effort frontmost process name (macOS). */
  computerFrontmost?(): Promise<{ ok?: boolean; frontmost?: string; note?: string; error?: string }>
  /** macOS AX tree query. Empty / unsupported returns fallback: vision. */
  computerAxQuery?(opts: ComputerAxQueryInput): Promise<ComputerAxResult>
  /** macOS AX focus or press. Act — requires Accessibility. */
  computerAxAct?(opts: ComputerAxActInput): Promise<ComputerAxResult>
  computerCaptureDisplay?(opts?: { displayId?: string; maxWidth?: number }): Promise<ComputerCapturePayload>
  computerClick?(opts: { x: number; y: number; button?: string; frameId?: string }): Promise<unknown>
  computerType?(opts: { text: string }): Promise<unknown>
  computerKey?(opts: { key: string }): Promise<unknown>
  computerScroll?(opts: {
    x?: number
    y?: number
    deltaY?: number
    direction?: string
    amount?: number
  }): Promise<unknown>
  computerMouseMove?(opts: { x: number; y: number; frameId?: string }): Promise<unknown>
  computerAbort?(): Promise<unknown>
  computerClearAbort?(): Promise<unknown>

  // Local OS system notifications (not remote push)
  getSystemNotificationPermission(): Promise<SystemNotificationPermission>
  requestSystemNotificationPermission(): Promise<SystemNotificationPermission>
  showSystemNotification(payload: SystemNotificationPayload): Promise<void>
  onSystemNotificationClick?(callback: (payload: SystemNotificationClickPayload) => void): () => void
}

/** Permission state for local OS notifications */
export type SystemNotificationPermission = 'granted' | 'denied' | 'default' | 'unsupported'

export type SystemNotificationPayload = {
  title: string
  body?: string
  /** Opaque data for click routing; never message content */
  data?: {
    sessionId?: string
    kind?: string
  }
}

export type SystemNotificationClickPayload = {
  sessionId?: string
  kind?: string
}

export type ScreenshotImagePayload = {
  mimeType: string
  base64: string
  fileName: string
}
export type ClipboardCapturePayload = { type: 'text'; text: string } | ({ type: 'image' } & ScreenshotImagePayload)

export type BrowserSessionStartPayload = {
  sessionId: string
  headless?: boolean
  downloadsEnabled?: boolean
  downloadDir?: string
  allowlist?: string[]
  channel?: 'chrome' | 'msedge'
  viewport?: { width: number; height: number }
}

export type BrowserStatusPayload = {
  running: boolean
  activePageId?: string | null
  tabCount?: number
  url?: string | null
  headless?: boolean
  downloadsEnabled?: boolean
}

export type BrowserSnapshotPayload = {
  url: string
  title: string
  snapshot: string
  truncated?: boolean
  refCount?: number
}

export type BrowserActPayload = {
  action: 'click' | 'type' | 'scroll'
  ref?: string
  text?: string
  button?: 'left' | 'right'
  submit?: boolean
  direction?: 'up' | 'down'
  amount?: number
}

export type BrowserTabsPayload = {
  op?: 'list' | 'select' | 'new' | 'close'
  action?: 'list' | 'select' | 'new' | 'close'
  tabId?: string
  url?: string
}

export type BrowserScreenshotPayload = {
  mimeType: string
  base64: string
  url?: string
}

export type ComputerPermissionStatus = {
  screenRecording: string
  accessibility: string
  platform?: string
  experimental?: boolean
  /** Probe method used by backend (e.g. tcc-process). */
  probe?: string
  /** Absolute path of the running process (dev: target/debug/dango). */
  executablePath?: string
  processName?: string
  isDevBinary?: boolean
  requested?: boolean
  requestGranted?: boolean
  /** CGPreflightScreenCaptureAccess result (may lag until restart after grant). */
  preflight?: boolean
  /** Real capture probe for this process. */
  captureProbe?: boolean
}

export type ComputerCapturePayload = {
  mimeType: string
  base64: string
  width?: number
  height?: number
  /** Native capture size before model downscale. */
  sourceWidth?: number
  sourceHeight?: number
  /** Actuator coordinate space (macOS points / native pixels). */
  actWidth?: number
  actHeight?: number
  scale?: number
  displayId?: string
  /** Opaque capture id — pin click/move coords to this frame. */
  frameId?: string
  fileName?: string
  /** Encoded payload size after resize/JPEG (not base64 string length). */
  byteLength?: number
}

export type ComputerAxRole = 'search' | 'text_field' | 'button' | 'any'

export type ComputerAxElement = {
  id: string
  role: string
  title?: string
  description?: string
  placeholder?: string
}

export type ComputerAxQueryInput = {
  role?: ComputerAxRole
  app?: string
  limit?: number
}

export type ComputerAxActInput = {
  action: 'focus' | 'press'
  role?: ComputerAxRole
  name?: string
  id?: string
  index?: number
  app?: string
}

export type ComputerAxResult = {
  ok?: boolean
  error?: string
  fallback?: 'vision'
  app?: string
  pid?: number
  elements?: ComputerAxElement[]
  acted?: boolean
  action?: string
  focused?: boolean
  pressed?: boolean
  note?: string
}

export interface Exporter {
  exportBlob: (filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16') => Promise<void>
  exportTextFile: (filename: string, content: string) => Promise<void>
  exportImageFile: (basename: string, base64: string) => Promise<void>
  exportByUrl: (filename: string, url: string) => Promise<void>
  exportStreamingJson: (filename: string, dataCallback: () => AsyncGenerator<string, void, unknown>) => Promise<void>
}

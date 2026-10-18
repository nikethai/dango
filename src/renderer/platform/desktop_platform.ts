/** biome-ignore-all lint/suspicious/noExplicitAny: <any> */

import type { DesktopIPC } from '@shared/desktop-ipc-types'
import type { Config, Settings, ShortcutSetting } from '@shared/types'
import { cache } from '@shared/utils/cache'
import { listen as tauriListen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import localforage from 'localforage'
import { v4 as uuidv4 } from 'uuid'
import { parseLocale } from '@/i18n/parser'
import type { TrayStatus } from '@/packages/menu-bar/tray-status'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import { getOS } from '../packages/navigator'
import type {
  ClipboardCapturePayload,
  FormFactor,
  Platform,
  PlatformType,
  ScreenshotImagePayload,
  SystemNotificationClickPayload,
  SystemNotificationPayload,
  SystemNotificationPermission,
} from './interfaces'
import DesktopKnowledgeBaseController from './knowledge-base/desktop-controller'
import WebExporter from './web_exporter'
import { parseTextFileLocally } from './web_platform_utils'

function listenShellEvent<T>(eventName: string, callback: (payload: T) => void): () => void {
  let unlisten: (() => void) | null = null
  let disposed = false
  void tauriListen<T>(eventName, (event) => {
    if (!disposed) {
      callback(event.payload)
    }
  })
    .then((dispose) => {
      if (disposed) {
        dispose()
      } else {
        unlisten = dispose
      }
    })
    .catch((err) => {
      console.error(`[desktop-shell] listen failed: ${eventName}`, err)
    })
  return () => {
    disposed = true
    unlisten?.()
  }
}

const store = localforage.createInstance({ name: 'chatboxstore' })

export default class DesktopPlatform implements Platform {
  public type: PlatformType = 'desktop'
  public formFactor: FormFactor = 'desktop'

  public exporter = new WebExporter()

  private _kbController?: DesktopKnowledgeBaseController
  private _imageGenerationStorage: ImageGenerationStorage | null = null

  public ipc: DesktopIPC
  constructor(ipc: DesktopIPC) {
    this.ipc = ipc
  }

  public getStorageType(): string {
    return 'INDEXEDDB'
  }

  public async getVersion() {
    return cache('ipc:getVersion', () => this.ipc.invoke('getVersion'), { ttl: 5 * 60 * 1000, memoryOnly: true })
  }
  public async getPlatform() {
    return cache('ipc:getPlatform', () => this.ipc.invoke('getPlatform'), { ttl: 5 * 60 * 1000 })
  }
  public async getArch() {
    return cache('ipc:getArch', () => this.ipc.invoke('getArch'), { ttl: 5 * 60 * 1000 })
  }
  public async shouldUseDarkColors(): Promise<boolean> {
    return await this.ipc.invoke('shouldUseDarkColors')
  }
  public onSystemThemeChange(callback: () => void): () => void {
    return this.ipc.onSystemThemeChange(callback)
  }
  public onWindowShow(callback: () => void): () => void {
    return this.ipc.onWindowShow(callback)
  }
  public onWindowFocused(callback: () => void): () => void {
    return this.ipc.onWindowFocused(callback)
  }
  public onUpdateDownloaded(callback: () => void): () => void {
    return this.ipc.onUpdateDownloaded(callback)
  }
  public onNavigate(callback: (path: string) => void): () => void {
    return this.ipc.onNavigate(callback)
  }
  public async openLink(url: string): Promise<void> {
    return this.ipc.invoke('openLink', url)
  }
  public async getDeviceName(): Promise<string> {
    const deviceName = await cache('ipc:getDeviceName', () => this.ipc.invoke('getDeviceName'), {
      ttl: 5 * 60 * 1000,
    })
    return deviceName
  }
  public async getInstanceName(): Promise<string> {
    const deviceName = await this.getDeviceName()
    return `${deviceName} / ${getOS()}`
  }
  public async getLocale() {
    const locale = await cache('ipc:getLocale', () => this.ipc.invoke('getLocale'), { ttl: 5 * 60 * 1000 })
    return parseLocale(locale)
  }
  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    return this.ipc.invoke('ensureShortcutConfig', JSON.stringify(config))
  }
  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    return this.ipc.invoke('ensureProxy', JSON.stringify(config))
  }
  public async relaunch(): Promise<void> {
    return this.ipc.invoke('relaunch')
  }

  public async getConfig(): Promise<Config> {
    return this.ipc.invoke('getConfig')
  }
  public async getSettings(): Promise<Settings> {
    return this.ipc.invoke('getSettings')
  }

  /**
   * Keys shared across all desktop windows via Tauri disk store.
   * Sessions must be shared so quick chat + main webview stay in sync
   * (each window has its own React Query cache / may partition IndexedDB).
   */
  private needStoreInFile(key: string): boolean {
    return (
      key === 'configs' ||
      key === 'settings' ||
      key === 'configVersion' ||
      key === 'chat-sessions-list' ||
      key === 'imported-history' ||
      key === 'myProjects' ||
      key === 'myFolders' ||
      key === 'projectMigrationJournal' ||
      key.startsWith('session:')
    )
  }

  public async setStoreValue(key: string, value: any) {
    // (legacy comment)
    // (legacy comment)
    let valueJson: string
    try {
      valueJson = JSON.stringify(value)
    } catch (error: any) {
      throw new Error(`Failed to serialize value for key "${key}": ${error.message}`)
    }
    if (this.needStoreInFile(key)) {
      return this.ipc.invoke('setStoreValue', key, valueJson)
    } else {
      await store.setItem(key, valueJson)
    }
  }
  public async getStoreValue(key: string) {
    if (this.needStoreInFile(key)) {
      let value = await this.ipc.invoke('getStoreValue', key)
      // One-time migrate: older builds stored sessions only in IndexedDB
      if ((value === null || value === undefined) && (key.startsWith('session:') || key === 'chat-sessions-list')) {
        const json = await store.getItem<string>(key)
        if (json) {
          try {
            value = typeof json === 'string' ? JSON.parse(json) : json
            await this.ipc.invoke('setStoreValue', key, typeof json === 'string' ? json : JSON.stringify(value))
          } catch (error) {
            console.error(`Failed to migrate stored value for key "${key}":`, error)
          }
        }
      }
      return value ?? null
    } else {
      const json = await store.getItem<string>(key)
      if (!json) return null
      try {
        return JSON.parse(json)
      } catch (error) {
        console.error(`Failed to parse stored value for key "${key}":`, error)
        return null
      }
    }
  }
  public async delStoreValue(key: string) {
    if (this.needStoreInFile(key)) {
      return this.ipc.invoke('delStoreValue', key)
    } else {
      return await store.removeItem(key)
    }
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const ret: { [key: string]: any } = {}
    await store.iterate((json, key) => {
      const value = typeof json === 'string' ? JSON.parse(json) : null
      ret[key] = value
    })
    const json = JSON.parse(await this.ipc.invoke('getAllStoreValues'))
    for (const [key, value] of Object.entries(json)) {
      if (this.needStoreInFile(key)) {
        ret[key] = value
      }
    }
    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    const keys = await store.keys()
    const ipcKeys: string[] = await this.ipc.invoke('getAllStoreKeys')
    return [...keys, ...ipcKeys]
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }

  public async getStoreBlob(key: string): Promise<string | null> {
    return this.ipc.invoke('getStoreBlob', key)
  }
  public async setStoreBlob(key: string, value: string) {
    return this.ipc.invoke('setStoreBlob', key, value)
  }
  public async delStoreBlob(key: string) {
    return this.ipc.invoke('delStoreBlob', key)
  }
  public async listStoreBlobKeys(): Promise<string[]> {
    return this.ipc.invoke('listStoreBlobKeys')
  }

  public initTracking(): void {
    setTimeout(() => {
      this.trackingEvent('user_engagement', {})
    }, 4000) // (legacy)
  }
  public trackingEvent(name: string, params: { [key: string]: string }) {
    const dataJson = JSON.stringify({ name, params })
    this.ipc.invoke('analysticTrackingEvent', dataJson)
  }

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return cache('ipc:shouldShowAboutDialogWhenStartUp', () => this.ipc.invoke('shouldShowAboutDialogWhenStartUp'), {
      ttl: 30 * 1000,
    })
  }

  public async appLog(level: string, message: string) {
    return this.ipc.invoke('appLog', JSON.stringify({ level, message }))
  }

  public async exportLogs(): Promise<string> {
    return this.ipc.invoke('exportLogs')
  }

  public async clearLogs(): Promise<void> {
    return this.ipc.invoke('clearLogs')
  }

  public async ensureAutoLaunch(enable: boolean) {
    return this.ipc.invoke('ensureAutoLaunch', enable)
  }

  pickImportedArchivePath = async (): Promise<string | null> => {
    const picked = await this.ipc.invoke('pickImportedArchive')
    return typeof picked === 'string' && picked.length > 0 ? picked : null
  }

  inspectImportedArchive = async (path: string): Promise<unknown> => {
    return this.ipc.invoke('inspectImportedArchive', path)
  }

  async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    let result: { text: string; isSupported: boolean }
    if (!file.path) {
      // (legacy comment)
      result = await parseTextFileLocally(file)
    } else {
      const resultJSON = await this.ipc.invoke('parseFileLocally', JSON.stringify({ filePath: file.path }))
      result = JSON.parse(resultJSON)
    }
    if (!result.isSupported) {
      return { isSupported: false }
    }
    const key = `parseFile-` + uuidv4()
    await this.setStoreBlob(key, result.text)
    return { key, isSupported: true }
  }

  async parseFileWithMineru(
    file: File,
    apiToken: string
  ): Promise<{ success: boolean; content?: string; error?: string; cancelled?: boolean }> {
    if (!file.path) {
      // Files without path (e.g., pasted files) are not supported for MinerU parsing
      return { success: false, error: 'File path is required for MinerU parsing' }
    }

    return this.ipc.invoke('parser:parse-file-with-mineru', {
      filePath: file.path,
      filename: file.name,
      mimeType: file.type,
      apiToken,
    })
  }

  async cancelMineruParse(filePath: string): Promise<{ success: boolean; error?: string }> {
    return this.ipc.invoke('parser:cancel-mineru-parse', filePath)
  }

  public async parseUrl(url: string): Promise<{ key: string; title: string }> {
    const json = await this.ipc.invoke('parseUrl', url)
    return JSON.parse(json)
  }

  public async isFullscreen() {
    return this.ipc.invoke('isFullscreen')
  }

  public async setFullscreen(enabled: boolean) {
    return this.ipc.invoke('setFullscreen', enabled)
  }

  public async installUpdate() {
    return this.ipc.invoke('install-update')
  }

  public async switchTheme(theme: 'dark' | 'light') {
    return this.ipc.invoke('switch-theme', theme)
  }

  public getKnowledgeBaseController() {
    if (!this._kbController) {
      this._kbController = new DesktopKnowledgeBaseController(this.ipc)
    }
    return this._kbController
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    if (!this._imageGenerationStorage) {
      this._imageGenerationStorage = new IndexedDBImageGenerationStorage()
    }
    return this._imageGenerationStorage
  }

  public async readFileByPath(_path: string): Promise<string> {
    throw new Error('Broad filesystem IPC is unavailable. Use workspace capability APIs.')
  }

  public async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error('Broad filesystem IPC is unavailable. Use workspace capability APIs.')
  }

  public async deleteFile(_path: string): Promise<void> {
    throw new Error('Broad filesystem IPC is unavailable. Use workspace capability APIs.')
  }

  private async invokeWorkspace<T>(channel: string, ...args: unknown[]): Promise<T> {
    const { unwrapWorkspaceBroker } = await import('./workspace-broker')
    const raw = await this.ipc.invoke(channel, ...args)
    return unwrapWorkspaceBroker<T>(raw)
  }

  private async revokeNativeMutationIfHidden() {
    const { getProjectWorkspaceFlags } = await import('@/projects/flags')
    if (!getProjectWorkspaceFlags().mutationEnabled) {
      await this.invokeWorkspace('workspace:set-mutation', false)
    }
  }

  public async pickAndBindProject(projectId: string) {
    const desc = await this.invokeWorkspace('workspace:pick-and-bind', projectId)
    await this.revokeNativeMutationIfHidden()
    return desc
  }

  public async restoreProjectBinding(projectId: string) {
    const desc = await this.invokeWorkspace('workspace:restore', projectId)
    await this.revokeNativeMutationIfHidden()
    return desc
  }

  public async revokeProjectBinding(projectId: string) {
    await this.invokeWorkspace('workspace:revoke', projectId)
  }

  public async relinkProject(projectId: string) {
    return this.invokeWorkspace('workspace:relink', projectId)
  }

  public async unbindProject(projectId: string) {
    await this.invokeWorkspace('workspace:unbind', projectId)
  }

  public async revealProject(projectId: string) {
    await this.invokeWorkspace('workspace:reveal', projectId)
  }

  public async readWorkspaceFile(capabilityId: string, relativePath: string) {
    return this.invokeWorkspace('workspace:read', { capabilityId, relativePath })
  }

  public async listWorkspaceChildren(capabilityId: string, relativePath: string, cursor?: string, requestId?: string) {
    return this.invokeWorkspace('workspace:list', { capabilityId, relativePath, cursor, requestId })
  }

  public async searchWorkspace(capabilityId: string, query: string, requestId?: string) {
    return this.invokeWorkspace('workspace:search', { capabilityId, query, requestId })
  }

  public async cancelWorkspaceRequest(requestId: string) {
    await this.invokeWorkspace('workspace:cancel', requestId)
  }

  public async getWorkspaceSuiteCapabilities() {
    return this.invokeWorkspace('workspace:capabilities')
  }

  public async createWorkspaceFile(
    _capabilityId: string,
    _relativePath: string,
    _content: string,
    _mode: 'create' | 'overwrite',
    _expectedRevision?: string
  ) {
    return { ok: false, code: 'MUTATION_DISABLED' as const }
  }

  public async editWorkspaceFile(
    _capabilityId: string,
    _relativePath: string,
    _oldString: string,
    _newString: string,
    _expectedRevision: string
  ) {
    return { ok: false, code: 'MUTATION_DISABLED' as const }
  }

  public async deleteWorkspaceFile(_capabilityId: string, _relativePath: string, _expectedRevision: string) {
    return { ok: false, code: 'MUTATION_DISABLED' as const }
  }

  public async beginWorkspaceChangeSet(capabilityId: string, sessionId: string, turnId: string) {
    return this.invokeWorkspace('changes:begin', { capabilityId, sessionId, turnId })
  }

  public async appendWorkspaceChange(changeSetId: string, operation: Record<string, unknown>) {
    return this.invokeWorkspace('changes:append', { changeSetId, operation })
  }

  public async sealWorkspaceChangeSet(changeSetId: string) {
    return this.invokeWorkspace('changes:seal', changeSetId)
  }

  public async getWorkspaceChangeSet(changeSetId: string) {
    return this.invokeWorkspace('changes:get', changeSetId)
  }

  public async discardWorkspaceChangeSet(changeSetId: string) {
    return this.invokeWorkspace('changes:discard', changeSetId)
  }

  public async preflightWorkspaceChangeSet(changeSetId: string, digest: string, selectedIds: string[]) {
    return this.invokeWorkspace('changes:preflight', { changeSetId, digest, selectedIds })
  }

  public async prepareWorkspaceApply(changeSetId: string, digest: string, selectedIds: string[]) {
    return this.invokeWorkspace('changes:prepare-apply', { changeSetId, digest, selectedIds })
  }

  public async applyWorkspaceChangeSet(applyTicket: string) {
    return this.invokeWorkspace('changes:apply', applyTicket)
  }

  public async prepareWorkspaceExport(capabilityId: string, selection: Record<string, unknown>) {
    return this.invokeWorkspace('workspace:prepare-export', { capabilityId, selection })
  }

  public async prepareAppArtifactExport(artifactId: string) {
    return this.invokeWorkspace('workspace:prepare-artifact-export', artifactId)
  }

  public async exportWorkspace(manifestId: string) {
    return this.invokeWorkspace('workspace:export', manifestId)
  }

  public async discardWorkspaceExport(manifestId: string) {
    return this.invokeWorkspace('workspace:discard-export', manifestId)
  }

  public async getSourceControlStatus(capabilityId: string) {
    return this.invokeWorkspace('scm:status', { capabilityId })
  }

  public async getSourceControlDiff(capabilityId: string, changeId?: string) {
    return this.invokeWorkspace('scm:diff', { capabilityId, changeId })
  }

  public async getSourceControlLog(capabilityId: string, limit?: number) {
    return this.invokeWorkspace('scm:log', { capabilityId, limit })
  }

  public async getLocalExecutionStatus() {
    return this.invokeWorkspace('wasi:status')
  }

  public async getManagedWorktreeStatus() {
    return this.invokeWorkspace('worktrees:status')
  }

  public async setProjectTrust(projectId: string, category: string, value: string) {
    await this.ipc.invoke('workspace:set-trust', projectId, category, value)
  }

  public async readCodexAuthConfig() {
    return this.ipc.invoke('codex:read-auth-config')
  }

  public async videoYtDlp(op: 'detect' | 'install') {
    return this.ipc.invoke('video:yt-dlp', op)
  }

  public minimize() {
    return this.ipc.invoke('window:minimize')
  }

  public maximize() {
    return this.ipc.invoke('window:maximize')
  }

  public unmaximize() {
    return this.ipc.invoke('window:unmaximize')
  }

  public closeWindow() {
    return this.ipc.invoke('window:close')
  }

  public isMaximized() {
    return this.ipc.invoke('window:is-maximized')
  }

  public onMaximizedChange(callback: (isMaximized: boolean) => void): () => void {
    const unsubscribe = this.ipc.onWindowMaximizedChanged((_, isMaximized) => {
      callback(isMaximized)
    })

    return unsubscribe
  }

  public async executeCommand(
    _command: string,
    _cwd?: string,
    _timeoutMs?: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    throw new Error('Generic project shell is unavailable.')
  }

  public async getSystemNotificationPermission(): Promise<SystemNotificationPermission> {
    try {
      const { isPermissionGranted } = await import('@tauri-apps/plugin-notification')
      const granted = await isPermissionGranted()
      return granted ? 'granted' : 'default'
    } catch {
      return 'unsupported'
    }
  }

  public async requestSystemNotificationPermission(): Promise<SystemNotificationPermission> {
    try {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification')
      if (await isPermissionGranted()) {
        return 'granted'
      }
      const result = await requestPermission()
      if (result === 'granted') return 'granted'
      if (result === 'denied') return 'denied'
      return 'default'
    } catch {
      return 'unsupported'
    }
  }

  public async showSystemNotification(payload: SystemNotificationPayload): Promise<void> {
    const { sendNotification } = await import('@tauri-apps/plugin-notification')
    sendNotification({
      title: payload.title,
      body: payload.body,
      extra: {
        sessionId: payload.data?.sessionId,
        kind: payload.data?.kind,
      },
    })
  }

  public onSystemNotificationClick(callback: (payload: SystemNotificationClickPayload) => void): () => void {
    let disposed = false
    let unregister: (() => void) | null = null

    void import('@tauri-apps/plugin-notification')
      .then(({ onAction }) =>
        onAction((notification) => {
          if (disposed) return
          const extra = (notification.extra ?? {}) as Record<string, unknown>
          callback({
            sessionId: typeof extra.sessionId === 'string' ? extra.sessionId : undefined,
            kind: typeof extra.kind === 'string' ? extra.kind : undefined,
          })
        })
      )
      .then((listener) => {
        if (disposed) {
          void listener.unregister()
          return
        }
        unregister = () => {
          void listener.unregister()
        }
      })
      .catch((err) => {
        console.error('[notifications] onAction listen failed', err)
      })

    return () => {
      disposed = true
      unregister?.()
    }
  }

  public async setKeepInTray(enabled: boolean): Promise<void> {
    return this.ipc.invoke('shell:setKeepInTray', enabled)
  }

  public async setQuickWindowAlwaysOnTop(enabled: boolean): Promise<void> {
    return this.ipc.invoke('shell:setQuickAlwaysOnTop', enabled)
  }

  public async showQuickWindow(): Promise<void> {
    return this.ipc.invoke('shell:showQuick')
  }

  public hideQuickWindow(): Promise<void> {
    return this.ipc.invoke('shell:hideQuick')
  }

  public setQuickWindowHeight(px: number): Promise<void> {
    return this.ipc.invoke('shell:setQuickHeight', px)
  }

  public async showMainWindow(): Promise<void> {
    return this.ipc.invoke('shell:showMain')
  }

  public async openSessionInMain(sessionId: string): Promise<void> {
    return this.ipc.invoke('shell:openSessionInMain', sessionId)
  }

  public async captureScreenshotRegion(): Promise<ScreenshotImagePayload | null> {
    try {
      return await this.ipc.invoke('shell:captureScreenshot')
    } catch {
      return null
    }
  }

  public async notifyQuickRendererReady(): Promise<void> {
    await this.ipc.invoke('shell:quickRendererReady')
  }

  public async notifyQuickRendererGone(): Promise<void> {
    await this.ipc.invoke('shell:quickRendererGone')
  }

  public async readClipboardImage(): Promise<ScreenshotImagePayload | null> {
    try {
      return await this.ipc.invoke('shell:readClipboardImage')
    } catch {
      return null
    }
  }

  public async getWindowLabel(): Promise<string> {
    try {
      return getCurrentWindow().label
    } catch {
      return 'main'
    }
  }

  public onQuickShown(callback: () => void): () => void {
    return listenShellEvent('shell:quick-shown', () => callback())
  }

  public onShellNavigate(callback: (path: string) => void): () => void {
    return listenShellEvent<string>('shell:navigate', (path) => {
      if (typeof path === 'string') {
        callback(path)
      }
    })
  }
  public onScreenshotCaptured(callback: (payload: ScreenshotImagePayload) => void): () => void {
    return listenShellEvent<ScreenshotImagePayload>('shell:screenshot-captured', (payload) => {
      if (payload?.base64) {
        callback(payload)
      }
    })
  }

  public onClipboardCaptured(callback: (payload: ClipboardCapturePayload) => void): () => void {
    return listenShellEvent<ClipboardCapturePayload>('shell:clipboard-captured', (payload) => {
      if (payload?.type === 'text' ? typeof payload.text === 'string' : Boolean(payload?.base64)) {
        callback(payload)
      }
    })
  }

  public onScreenshotError(callback: (message: string) => void): () => void {
    return listenShellEvent<{ message?: string }>('shell:screenshot-error', (payload) => {
      callback(payload?.message || 'Screenshot failed')
    })
  }

  public onHiddenToTray(callback: () => void): () => void {
    return listenShellEvent('shell:hidden-to-tray', () => callback())
  }

  public async setTrayStatus(status: TrayStatus): Promise<void> {
    await this.ipc.invoke('shell:setTrayStatus', status)
  }

  public onTrayPauseToggle(callback: () => void): () => void {
    return listenShellEvent('shell:tray-pause-toggle', () => callback())
  }

  // --- Agent browser (isolated Chromium) ---

  public async browserSessionStart(opts: import('./interfaces').BrowserSessionStartPayload) {
    return this.ipc.invoke('browser:session:start', opts)
  }

  public async browserSessionStop(sessionId: string) {
    return this.ipc.invoke('browser:session:stop', { sessionId })
  }

  public async browserSessionStatus(sessionId: string) {
    return this.ipc.invoke('browser:session:status', { sessionId })
  }

  public async browserSessionWipe(sessionId: string) {
    return this.ipc.invoke('browser:session:wipe', { sessionId })
  }

  public async browserNavigate(sessionId: string, url: string) {
    return this.ipc.invoke('browser:navigate', { sessionId, url })
  }

  public async browserSnapshot(sessionId: string, opts?: { interestingOnly?: boolean }) {
    return this.ipc.invoke('browser:snapshot', { sessionId, ...opts })
  }

  public async browserAct(sessionId: string, action: import('./interfaces').BrowserActPayload) {
    return this.ipc.invoke('browser:act', { sessionId, ...action })
  }

  public async browserTabs(sessionId: string, op: import('./interfaces').BrowserTabsPayload) {
    return this.ipc.invoke('browser:tabs', { sessionId, ...op })
  }

  public async browserScreenshot(sessionId: string) {
    return this.ipc.invoke('browser:screenshot', { sessionId })
  }

  // --- Computer use ---

  public async computerListDisplays() {
    return this.ipc.invoke('computer:list-displays')
  }

  public async computerPermissionStatus() {
    return this.ipc.invoke('computer:permission-status')
  }

  public async computerPermissionRequest() {
    return this.ipc.invoke('computer:permission-request')
  }

  public async computerRevealExecutable() {
    return this.ipc.invoke('computer:reveal-executable')
  }

  public async computerCaptureDisplay(opts?: { displayId?: string; maxWidth?: number }) {
    return this.ipc.invoke('computer:capture-display', opts || {})
  }

  public async computerOpenApp(opts: { name: string }) {
    return this.ipc.invoke('computer:open-app', opts)
  }

  public async computerOpenUri(opts: { uri: string }) {
    return this.ipc.invoke('computer:open-uri', opts)
  }

  public async computerFrontmost() {
    return this.ipc.invoke('computer:frontmost')
  }

  public async computerAxQuery(opts: import('./interfaces').ComputerAxQueryInput) {
    return this.ipc.invoke('computer:ax-query', opts || {})
  }

  public async computerAxAct(opts: import('./interfaces').ComputerAxActInput) {
    return this.ipc.invoke('computer:ax-act', opts)
  }

  public async computerClick(opts: { x: number; y: number; button?: string; frameId?: string }) {
    return this.ipc.invoke('computer:click', opts)
  }

  public async computerType(opts: { text: string }) {
    return this.ipc.invoke('computer:type', opts)
  }

  public async computerKey(opts: { key: string }) {
    return this.ipc.invoke('computer:key', opts)
  }

  public async computerScroll(opts: { x?: number; y?: number; deltaY?: number; direction?: string; amount?: number }) {
    return this.ipc.invoke('computer:scroll', opts)
  }

  public async computerMouseMove(opts: { x: number; y: number; frameId?: string }) {
    return this.ipc.invoke('computer:mouse-move', opts)
  }

  public async computerAbort() {
    return this.ipc.invoke('computer:abort')
  }

  public async computerClearAbort() {
    return this.ipc.invoke('computer:clear-abort')
  }
}

/**
 * TestPlatform -
 *
 * (legacy comment removed)
 * (legacy comment removed)
 * (legacy comment removed)
 * (legacy comment removed)
 */

import * as defaults from '@shared/defaults'
import type { Config, Language, Settings, ShortcutSetting } from '@shared/types'
import { v4 as uuidv4 } from 'uuid'
import type { TrayStatus } from '@/packages/menu-bar/tray-status'
import { type ImageGenerationStorage, IndexedDBImageGenerationStorage } from '@/storage/ImageGenerationStorage'
import type {
  Exporter,
  FormFactor,
  Platform,
  PlatformType,
  Storage,
  SystemNotificationClickPayload,
  SystemNotificationPayload,
  SystemNotificationPermission,
} from './interfaces'
import type { KnowledgeBaseController } from './knowledge-base/interface'

/**
 * (legacy comment removed)
 */
export class InMemoryStorage implements Storage {
  private store = new Map<string, any>()

  public getStorageType(): string {
    return 'IN_MEMORY'
  }

  public async setStoreValue(key: string, value: any): Promise<void> {
    this.store.set(key, JSON.parse(JSON.stringify(value)))
  }

  public async getStoreValue(key: string): Promise<any> {
    const value = this.store.get(key)
    return value !== undefined ? value : null
  }

  public async delStoreValue(key: string): Promise<void> {
    this.store.delete(key)
  }

  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const result: { [key: string]: any } = {}
    this.store.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  public async getAllStoreKeys(): Promise<string[]> {
    return Array.from(this.store.keys())
  }

  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }

  public clear(): void {
    this.store.clear()
  }
}

/**
 * (legacy comment removed)
 */
class TestExporter implements Exporter {
  private exports: Map<string, any> = new Map()

  async exportBlob(filename: string, blob: Blob, encoding?: 'utf8' | 'ascii' | 'utf16'): Promise<void> {
    const text = await blob.text()
    this.exports.set(filename, text)
  }

  async exportTextFile(filename: string, content: string): Promise<void> {
    this.exports.set(filename, content)
  }

  async exportImageFile(basename: string, base64: string): Promise<void> {
    this.exports.set(basename, base64)
  }

  async exportByUrl(filename: string, url: string): Promise<void> {
    this.exports.set(filename, url)
  }

  async exportStreamingJson(
    filename: string,
    dataCallback: () => AsyncGenerator<string, void, unknown>
  ): Promise<void> {
    let content = ''
    for await (const chunk of dataCallback()) {
      content += chunk
    }
    this.exports.set(filename, content)
  }

  getExport(filename: string): any {
    return this.exports.get(filename)
  }

  getAllExports(): Map<string, any> {
    return new Map(this.exports)
  }

  clear(): void {
    this.exports.clear()
  }
}

/**
 * TestPlatform
 */
export default class TestPlatform implements Platform {
  public type: PlatformType = 'web'
  public formFactor: FormFactor = 'desktop'
  public exporter: TestExporter = new TestExporter()

  private storage = new InMemoryStorage()
  private blobs = new Map<string, string>()
  private files = new Map<string, string>()
  private configs: Config | null = null
  private settings: Settings | null = null
  /** Recorded system notifications for tests */
  public systemNotifications: SystemNotificationPayload[] = []
  public systemNotificationPermission: SystemNotificationPermission = 'granted'
  /** Recorded quick window heights (setQuickWindowHeight) for tests */
  public quickWindowHeights: number[] = []
  /** Recorded tray statuses (setTrayStatus) for tests */
  public trayStatuses: TrayStatus[] = []
  /** Number of hideQuickWindow calls for tests */
  public quickHidden = 0
  /** Paths passed to openInMain, for tests */
  public openedInMain: string[] = []
  private systemNotificationClickHandlers = new Set<(payload: SystemNotificationClickPayload) => void>()

  constructor() {
    // (legacy comment removed)
    this.configs = defaults.newConfigs()
    this.settings = defaults.settings()
  }

  // ============ Storage ============

  public getStorageType(): string {
    return 'IN_MEMORY_TEST'
  }

  public async setStoreValue(key: string, value: any): Promise<void> {
    return this.storage.setStoreValue(key, value)
  }

  public async getStoreValue(key: string): Promise<any> {
    return this.storage.getStoreValue(key)
  }

  public async delStoreValue(key: string): Promise<void> {
    return this.storage.delStoreValue(key)
  }

  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    return this.storage.getAllStoreValues()
  }

  public async getAllStoreKeys(): Promise<string[]> {
    return this.storage.getAllStoreKeys()
  }

  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    return this.storage.setAllStoreValues(data)
  }

  // ============ Blob ============

  public async getStoreBlob(key: string): Promise<string | null> {
    return this.blobs.get(key) ?? null
  }

  public async setStoreBlob(key: string, value: string): Promise<void> {
    this.blobs.set(key, value)
  }

  public async delStoreBlob(key: string): Promise<void> {
    this.blobs.delete(key)
  }

  public async listStoreBlobKeys(): Promise<string[]> {
    return Array.from(this.blobs.keys())
  }

  // (legacy comment removed)

  public async getVersion(): Promise<string> {
    return 'test'
  }

  public async getPlatform(): Promise<string> {
    return 'test'
  }

  public async getArch(): Promise<string> {
    return 'test'
  }

  public async shouldUseDarkColors(): Promise<boolean> {
    return false
  }

  public onSystemThemeChange(callback: () => void): () => void {
    return () => {}
  }

  public onWindowShow(callback: () => void): () => void {
    return () => {}
  }

  public onWindowFocused(callback: () => void): () => void {
    return () => {}
  }

  public onUpdateDownloaded(callback: () => void): () => void {
    return () => {}
  }

  public async openLink(url: string): Promise<void> {
    // no-op in test
  }

  public async getDeviceName(): Promise<string> {
    return 'test-device'
  }

  public async getInstanceName(): Promise<string> {
    return 'test-instance'
  }

  public async getLocale(): Promise<Language> {
    return 'en'
  }

  public async ensureShortcutConfig(config: ShortcutSetting): Promise<void> {
    // no-op in test
  }

  public async ensureProxyConfig(config: { proxy?: string }): Promise<void> {
    // no-op in test
  }

  public async relaunch(): Promise<void> {
    // no-op in test
  }

  // (legacy comment removed)

  public async getConfig(): Promise<Config> {
    if (!this.configs) {
      this.configs = defaults.newConfigs()
    }
    return this.configs
  }

  public async getSettings(): Promise<Settings> {
    if (!this.settings) {
      this.settings = defaults.settings()
    }
    return this.settings
  }

  // (legacy comment removed)

  public initTracking(): void {
    // no-op in test
  }

  public trackingEvent(name: string, params: { [key: string]: string }): void {
    // no-op in test
  }

  // (legacy comment removed)

  public async shouldShowAboutDialogWhenStartUp(): Promise<boolean> {
    return false
  }

  public async appLog(level: string, message: string): Promise<void> {
    console.log(`[${level}] ${message}`)
  }

  public async exportLogs(): Promise<string> {
    return ''
  }

  public async clearLogs(): Promise<void> {
    // no-op
  }

  public async ensureAutoLaunch(enable: boolean): Promise<void> {
    // no-op
  }

  public async pickImportedArchivePath(): Promise<string | null> {
    return null
  }

  public async inspectImportedArchive(_path: string): Promise<unknown> {
    throw new Error('Use importChatGptArchiveFromPath in tests')
  }

  public async parseFileLocally(file: File): Promise<{ key?: string; isSupported: boolean }> {
    // (legacy comment removed)
    try {
      const text = await file.text()
      const key = `parseFile-${uuidv4()}`
      await this.setStoreBlob(key, text)
      return { key, isSupported: true }
    } catch {
      return { isSupported: false }
    }
  }

  public async isFullscreen(): Promise<boolean> {
    return false
  }

  public async setFullscreen(enabled: boolean): Promise<void> {
    // no-op
  }

  public async installUpdate(): Promise<void> {
    throw new Error('Method not implemented in test platform.')
  }

  public getKnowledgeBaseController(): KnowledgeBaseController {
    throw new Error('Knowledge base not implemented in test platform.')
  }

  public getImageGenerationStorage(): ImageGenerationStorage {
    return new IndexedDBImageGenerationStorage()
  }

  // ============ Filesystem operations ============

  public async readFileByPath(_path: string): Promise<string> {
    throw new Error('UNSUPPORTED_PLATFORM: privileged workspace access is unavailable on TestPlatform')
  }

  public async writeFile(_path: string, _content: string): Promise<void> {
    throw new Error('UNSUPPORTED_PLATFORM: privileged workspace access is unavailable on TestPlatform')
  }

  public async deleteFile(_path: string): Promise<void> {
    throw new Error('UNSUPPORTED_PLATFORM: privileged workspace access is unavailable on TestPlatform')
  }

  public async pickAndBindProject(_projectId: string): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async restoreProjectBinding(_projectId: string): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async readWorkspaceFile(_capabilityId: string, _relativePath: string): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async createWorkspaceFile(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async editWorkspaceFile(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async deleteWorkspaceFile(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async applyWorkspaceChangeSet(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async beginWorkspaceChangeSet(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async prepareWorkspaceExport(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async getSourceControlStatus(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async getLocalExecutionStatus(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async getManagedWorktreeStatus(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public async getWorkspaceSuiteCapabilities(): Promise<never> {
    throw new Error('UNSUPPORTED_PLATFORM')
  }

  public getWindowLabel(): Promise<string> {
    return Promise.resolve('test')
  }

  public hideQuickWindow(): Promise<void> {
    this.quickHidden += 1
    return Promise.resolve()
  }

  public openInMain(path: string): Promise<void> {
    this.openedInMain.push(path)
    return Promise.resolve()
  }

  public setTrayStatus(status: TrayStatus): Promise<void> {
    this.trayStatuses.push(status)
    return Promise.resolve()
  }

  public setQuickWindowHeight(px: number): Promise<void> {
    this.quickWindowHeights.push(px)
    return Promise.resolve()
  }

  public async getSystemNotificationPermission(): Promise<SystemNotificationPermission> {
    return this.systemNotificationPermission
  }

  public async requestSystemNotificationPermission(): Promise<SystemNotificationPermission> {
    if (this.systemNotificationPermission === 'unsupported') {
      return 'unsupported'
    }
    this.systemNotificationPermission = 'granted'
    return 'granted'
  }

  public async showSystemNotification(payload: SystemNotificationPayload): Promise<void> {
    this.systemNotifications.push(payload)
  }

  public onSystemNotificationClick(callback: (payload: SystemNotificationClickPayload) => void): () => void {
    this.systemNotificationClickHandlers.add(callback)
    return () => {
      this.systemNotificationClickHandlers.delete(callback)
    }
  }

  /** Test helper: simulate user clicking a system notification */
  public emitSystemNotificationClick(payload: SystemNotificationClickPayload): void {
    for (const cb of this.systemNotificationClickHandlers) {
      cb(payload)
    }
  }

  public async minimize(): Promise<void> {
    // no-op
  }

  public async maximize(): Promise<void> {
    // no-op
  }

  public async unmaximize(): Promise<void> {
    // no-op
  }

  public async closeWindow(): Promise<void> {
    // no-op
  }

  public async isMaximized(): Promise<boolean> {
    return false
  }

  public onMaximizedChange(callback: (isMaximized: boolean) => void): () => void {
    return () => {}
  }

  // (legacy comment removed)

  /**
   * (legacy comment)
   * @param storageKey
   * @param content
   */
  public loadFile(storageKey: string, content: string): void {
    this.blobs.set(storageKey, content)
  }

  /**
   * (legacy comment removed)
   * @param files { storageKey: content }
   */
  public loadFiles(files: Record<string, string>): void {
    for (const [key, content] of Object.entries(files)) {
      this.blobs.set(key, content)
    }
  }

  /**
   * (legacy comment)
   */
  public getAllBlobs(): Record<string, string> {
    const result: Record<string, string> = {}
    this.blobs.forEach((value, key) => {
      result[key] = value
    })
    return result
  }

  /**
   * (legacy comment removed)
   */
  public clear(): void {
    this.storage.clear()
    this.blobs.clear()
    this.files.clear()
    this.exporter.clear()
    this.configs = null
    this.settings = null
  }

  /**
   *  settings
   */
  public setSettings(settings: Partial<Settings>): void {
    this.settings = { ...defaults.settings(), ...settings }
  }

  /**
   *  config
   */
  public setConfig(config: Partial<Config>): void {
    this.configs = { ...defaults.newConfigs(), ...config }
  }

  /**
   * (legacy comment removed)
   */
  public getInternalStorage(): InMemoryStorage {
    return this.storage
  }
}

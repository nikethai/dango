import type { DebouncedFunc } from 'lodash'
import debounce from 'lodash/debounce'
import { v4 as uuidv4 } from 'uuid'
import BaseStorage from './BaseStorage'

export enum StorageKey {
  ChatSessions = 'chat-sessions',
  Configs = 'configs',
  Settings = 'settings',
  MyCopilots = 'myCopilots',
  MyFolders = 'myFolders',
  MyProjects = 'myProjects',
  PromptPresets = 'promptPresets',
  SystemPromptPresets = 'systemPromptPresets',
  Skills = 'skills',
  Commands = 'commands',
  HookOverrides = 'hookOverrides',
  ConfigVersion = 'configVersion',
  RemoteConfig = 'remoteConfig',
  ChatSessionsList = 'chat-sessions-list',
  ChatSessionSettings = 'chat-session-settings',
  PictureSessionSettings = 'picture-session-settings',
  AuthInfo = 'authInfo',
  /** Cross-session AI memory settings */
  MemorySettings = 'memory-settings',
  /** Global memory bank (shared across models/agents) */
  MemoryBankGlobal = 'memory-bank-global',
  /** Local usage rollup (day × provider × model) */
  UsageRollup = 'usage-rollup',
  /** Cached provider quota snapshots */
  UsageQuotaCache = 'usage-quota-cache',
  /** Soft budget one-shot notify state */
  UsageBudgetNotify = 'usage-budget-notify',
  /**
   * Connected accounts metadata (Integrations). Secrets are NOT stored here —
   * see integration-secret:* / OS keychain via secret-store.
   */
  Integrations = 'integrations',
  /** Device-local imported vendor archives. Never use session: keys. */
  ImportedHistory = 'imported-history',
  /** Review feed entries (shared by main and Quick Chat windows; IndexedDB). */
  ReviewEntries = 'review-entries',
}

export const StorageKeyGenerator = {
  session(id: string) {
    return `session:${id}`
  },
  /** Agent task checklist for a chat session (reload-safe). */
  sessionTasks(sessionId: string) {
    return `session:${sessionId}:tasks`
  },
  /** Per-agent memory bank */
  memoryAgent(agentId: string) {
    return `memory:agent:${agentId}`
  },
  picture(category: string) {
    return `picture:${category}:${uuidv4()}`
  },
  file(sessionId: string, msgId: string) {
    return `file:${sessionId}:${msgId}:${uuidv4()}`
  },
  fileUniqKey(file: File) {
    return `file_uniq:${file.name}:${file.size}:${file.lastModified}`
  },
  /** Stable key for uploaded video binary (data URL blob). */
  videoUniqKey(file: File) {
    return `video_uniq:${file.name}:${file.size}:${file.lastModified}`
  },
  linkUniqKey(url: string) {
    return `link_uniq:${url}`
  },
}

export default class StoreStorage extends BaseStorage {
  private immediateKeys = new Set<string>([
    StorageKey.Settings,
    StorageKey.Configs,
    StorageKey.ConfigVersion,
    StorageKey.MemorySettings,
    StorageKey.MemoryBankGlobal,
    StorageKey.UsageBudgetNotify,
    StorageKey.Integrations,
    StorageKey.ImportedHistory,
    StorageKey.ReviewEntries,
    // Scope lists hold a client scope's privacy switch (readsEverywhere); a debounced write can lose it on quit.
    StorageKey.MyProjects,
    StorageKey.MyFolders,
  ])

  public async getItem<T>(key: string, initialValue: T): Promise<T> {
    const value: T = await super.getItem(key, initialValue)

    if (key === StorageKey.Configs && value === initialValue) {
      await super.setItemNow(key, initialValue) // uuid
    }

    return value
  }

  private debounceQueue = new Map<string, DebouncedFunc<(key: string, value: unknown) => void>>()

  public async setItemNow<T>(key: string, value: T): Promise<void> {
    return super.setItemNow(key, value)
  }

  public async setItem<T>(key: string, value: T): Promise<void> {
    // These keys are startup-critical and should not be dropped on fast restarts.
    if (this.immediateKeys.has(key) || key.startsWith('memory:agent:')) {
      await this.setItemNow(key, value)
      return
    }

    let debounced = this.debounceQueue.get(key)
    if (!debounced) {
      debounced = debounce(this.setItemNow.bind(this), 500, { maxWait: 2000 })
      this.debounceQueue.set(key, debounced)
    }
    debounced(key, value)
  }
}

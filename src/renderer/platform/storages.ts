import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite'
import localforage from 'localforage'
import { StorageKey } from '@/storage'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import type { PlatformType, Storage } from './interfaces'
import { isTauriRuntime } from './tauri_ipc_adapter'

/**
 * Resolve platform type without importing `./index` (breaks circular:
 * index → web_platform → storages → index).
 * Mirrors platform/index initPlatform() detection for legacy migration only.
 */
function detectPlatformTypeForLegacyStorage(): PlatformType {
  if (process.env.NODE_ENV === 'test') {
    return 'desktop'
  }
  if (typeof window !== 'undefined') {
    if (window.desktopAPI || isTauriRuntime()) {
      // Tauri Android uses desktop IPC + file storage (same as DesktopPlatform)
      return 'desktop'
    }
  }
  if (CHATBOX_BUILD_PLATFORM === 'android' || CHATBOX_BUILD_PLATFORM === 'ios') {
    return 'mobile'
  }
  return 'web'
}

/**
 * A localforage entry as text: values are written as JSON strings, so a string is returned as is; anything else
 * (never written by this app) is serialised, so it never reads as missing.
 */
function rawText(stored: unknown): string | null {
  if (stored === null || stored === undefined) return null
  if (typeof stored === 'string') return stored
  try {
    return JSON.stringify(stored) ?? String(stored)
  } catch {
    return String(stored)
  }
}

export class DesktopFileStorage implements Storage {
  public ipc = window.desktopAPI

  public getStorageType(): string {
    return 'DESKTOP_FILE'
  }

  public async setStoreValue(key: string, value: any) {
    // (legacy comment removed)
    // (legacy comment)
    // (legacy comment)
    // Uncaught (in promise) Error: An object could not be cloned.
    // (legacy comment)
    const valueJson = JSON.stringify(value)
    return this.ipc.invoke('setStoreValue', key, valueJson)
  }
  public async getStoreValue(key: string) {
    return this.ipc.invoke('getStoreValue', key)
  }
  public delStoreValue(key: string) {
    return this.ipc.invoke('delStoreValue', key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const json = await this.ipc.invoke('getAllStoreValues')
    return JSON.parse(json)
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.ipc.invoke('getAllStoreKeys')
  }
  public async setAllStoreValues(data: { [key: string]: any }) {
    await this.ipc.invoke('setAllStoreValues', JSON.stringify(data))
  }
}

export class LocalStorage implements Storage {
  // LocalStorageConfigVersion=6，key
  validStorageKeys: string[] = [
    StorageKey.ConfigVersion,
    StorageKey.Configs,
    StorageKey.Settings,
    StorageKey.MyCopilots,
    StorageKey.MyFolders,
    StorageKey.MyProjects,
    StorageKey.PromptPresets,
    StorageKey.ChatSessions,
  ]

  public getStorageType(): string {
    return 'LOCAL_STORAGE'
  }

  public async setStoreValue(key: string, value: any) {
    // (legacy comment)
    // (legacy comment)
    localStorage.setItem(key, JSON.stringify(value))
  }
  public async getStoreValue(key: string) {
    const json = localStorage.getItem(key)
    return json ? JSON.parse(json) : null
  }
  public getStoreRaw(key: string): Promise<string | null> {
    return Promise.resolve(localStorage.getItem(key))
  }
  public async delStoreValue(key: string) {
    return localStorage.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const ret: { [key: string]: any } = {}

    // (legacy comment)
    for (const key of this.validStorageKeys) {
      const val = localStorage.getItem(key)
      if (val) {
        try {
          ret[key] = JSON.parse(val)
        } catch (error) {
          console.error(`Failed to parse stored value for key "${key}":`, error)
        }
      }
    }

    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    // (legacy comment)
    return Object.keys(localStorage).filter((k) => this.validStorageKeys.includes(k))
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

class SQLiteStorage {
  private sqlite: SQLiteConnection
  private database!: SQLiteDBConnection
  private initializePromise: Promise<void>

  constructor() {
    this.sqlite = new SQLiteConnection(CapacitorSQLite)
    this.initializePromise = this.initialize() // Promise
  }

  // (legacy comment removed)
  private async initialize(): Promise<void> {
    try {
      // reloadconnection already open，
      this.sqlite.closeConnection('chatbox.db', false)
      this.database = await this.sqlite.createConnection('chatbox.db', false, 'no-encryption', 1, false)

      // (legacy comment removed)
      const createTable = `
                CREATE TABLE IF NOT EXISTS key_value (
                    key TEXT PRIMARY KEY NOT NULL,
                    value TEXT
                );
            `
      await this.database.open()
      await this.database.execute(createTable)
    } catch (error) {
      console.error('Failed to initialize database', error)
      throw error
    }
  }

  // (legacy comment removed)
  private async ensureInitialized(): Promise<void> {
    await this.initializePromise
  }

  // (legacy comment removed)
  async setItem(key: string, value: string): Promise<void> {
    await this.ensureInitialized()

    try {
      const query = `
          INSERT OR REPLACE INTO key_value (key, value)
          VALUES (?, ?);
        `
      await this.database.run(query, [key, value])
    } catch (error) {
      console.error('Failed to set value', error)
      throw error
    }
  }

  // (legacy comment removed)
  async getItem(key: string): Promise<string | null> {
    await this.ensureInitialized()

    try {
      const query = `
          SELECT value FROM key_value
          WHERE key = ?;
        `
      const result = await this.database.query(query, [key])
      return result.values?.[0]?.value || null
    } catch (error) {
      console.error('Failed to get value', error)
      throw error
    }
  }

  // (legacy comment removed)
  async removeItem(key: string): Promise<void> {
    await this.ensureInitialized()

    try {
      const query = `
          DELETE FROM key_value
          WHERE key = ?;
        `
      await this.database.run(query, [key])
    } catch (error) {
      console.error('Failed to delete value', error)
      throw error
    }
  }

  // (legacy comment removed)
  async getAllItems(): Promise<{ [key: string]: any }> {
    await this.ensureInitialized()

    try {
      const query = `
            SELECT * FROM key_value;
          `
      const result = await this.database.query(query)
      // { [key: string]: value }
      const keyValueObject: { [key: string]: any } = {}
      if (result.values && result.values.length > 0) {
        result.values.forEach((row) => {
          keyValueObject[row.key] = row.value
        })
      }
      return keyValueObject
    } catch (error) {
      console.error('Failed to get all values', error)
      throw error
    }
  }

  // (legacy comment removed)
  async getAllKeys(): Promise<string[]> {
    await this.ensureInitialized()

    try {
      const query = `
            SELECT key FROM key_value;
          `
      const result = await this.database.query(query)
      // (legacy comment)
      const keys: string[] = []
      if (result.values && result.values.length > 0) {
        result.values.forEach((row) => {
          keys.push(row.key)
        })
      }
      return keys
    } catch (error) {
      console.error('Failed to get all keys', error)
      throw error
    }
  }

  // (legacy comment removed)
  async closeDatabase(): Promise<void> {
    await this.ensureInitialized()

    if (this.database) {
      await this.database.close()
    }
  }
}

export class MobileSQLiteStorage implements Storage {
  public getStorageType(): string {
    return 'MOBILE_SQLITE'
  }
  private sqliteStorage = new SQLiteStorage()

  public async setStoreValue(key: string, value: any) {
    await this.sqliteStorage.setItem(key, JSON.stringify(value))
  }
  public async getStoreValue(key: string) {
    const json = await this.sqliteStorage.getItem(key)
    return json ? JSON.parse(json) : null
  }
  public getStoreRaw(key: string): Promise<string | null> {
    return this.sqliteStorage.getItem(key)
  }
  public async delStoreValue(key: string) {
    await this.sqliteStorage.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const items = await this.sqliteStorage.getAllItems()
    for (const key in items) {
      if (items[key] && typeof items[key] === 'string') {
        try {
          items[key] = JSON.parse(items[key])
        } catch (error) {
          console.error(`Failed to parse stored value for key "${key}":`, error)
        }
      }
    }
    return items
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.sqliteStorage.getAllKeys()
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

export class IndexedDBStorage implements Storage {
  private store = localforage.createInstance({ name: 'chatboxstore' })

  public getStorageType(): string {
    return 'INDEXEDDB'
  }

  public async setStoreValue(key: string, value: any) {
    // (legacy comment)
    // (legacy comment)
    try {
      await this.store.setItem(key, JSON.stringify(value))
    } catch (error) {
      throw new Error(`Failed to store value for key "${key}": ${(error as Error).message}`)
    }
  }
  public async getStoreValue(key: string) {
    const json = await this.store.getItem<string>(key)
    if (!json) return null
    try {
      return JSON.parse(json)
    } catch (error) {
      console.error(`Failed to parse stored value for key "${key}":`, error)
      return null
    }
  }
  public async getStoreRaw(key: string): Promise<string | null> {
    return rawText(await this.store.getItem<unknown>(key))
  }
  public async delStoreValue(key: string) {
    return await this.store.removeItem(key)
  }
  public async getAllStoreValues(): Promise<{ [key: string]: any }> {
    const ret: { [key: string]: any } = {}
    await this.store.iterate((json, key) => {
      if (typeof json === 'string') {
        try {
          ret[key] = JSON.parse(json)
        } catch (error) {
          console.error(`Failed to parse value for key "${key}":`, error)
          ret[key] = null
        }
      } else {
        ret[key] = null
      }
    })
    return ret
  }
  public async getAllStoreKeys(): Promise<string[]> {
    return this.store.keys()
  }
  public async setAllStoreValues(data: { [key: string]: any }): Promise<void> {
    for (const [key, value] of Object.entries(data)) {
      await this.setStoreValue(key, value)
    }
  }
}

// Storage selection keys off platform.type (not formFactor) because it must match
// the actual storage backend. Tauri Android uses DesktopPlatform with Tauri IPC
// file-based storage, so it correctly follows the 'desktop' path here.
// Optional platformType avoids importing platform/index (circular dependency).
export function getOldVersionStorages(platformType?: PlatformType): Storage[] {
  const type = platformType ?? detectPlatformTypeForLegacyStorage()
  if (type === 'desktop') {
    return [new DesktopFileStorage()]
  }
  if (type === 'mobile') {
    return [new IndexedDBStorage(), new MobileSQLiteStorage(), new LocalStorage()]
  }
  return [new LocalStorage()]
}

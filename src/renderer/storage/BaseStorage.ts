import { getLogger } from '@/lib/utils'
import platform from '@/platform'

const log = getLogger('base-storage')

export default class BaseStorage {
  constructor() {}

  public getStorageType() {
    return platform.getStorageType()
  }

  public async setItem<T>(key: string, value: T): Promise<void> {
    return this.setItemNow(key, value)
  }

  public async setItemNow<T>(key: string, value: T): Promise<void> {
    try {
      if (key === 'settings') {
        const valueObj = value as Record<string, unknown>
        const providers = valueObj?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(
            `[CONFIG_DEBUG] setItemNow settings with providersCount=0, stack=${new Error().stack?.split('\n').slice(1, 6).join(' <- ')}`
          )
        }
      }
      return await platform.setStoreValue(key, value)
    } catch (error) {
      log.error(`Failed to write to storage (key: ${key}):`, error)
      throw error
    }
  }

  public async getItem<T>(key: string, initialValue: T): Promise<T> {
    try {
      let value: unknown = await platform.getStoreValue(key)
      if (value === undefined || value === null) {
        value = initialValue
        if (key === 'settings') {
          log.info(`[CONFIG_DEBUG] getItem settings: value was null/undefined, using initialValue`)
        }
        this.setItemNow(key, value)
      } else if (key === 'settings') {
        const providers = (value as Record<string, unknown>)?.providers
        const providersCount =
          providers && typeof providers === 'object' && !Array.isArray(providers) ? Object.keys(providers).length : 0
        if (providersCount === 0) {
          log.info(`[CONFIG_DEBUG] getItem settings: read providersCount=0 from storage`)
        }
      }
      return value as T
    } catch (error) {
      log.error(`Failed to read from storage (key: ${key}):`, error)
      throw error
    }
  }

  /**
   * The stored value, or `null`/`undefined` when there is none. Unlike `getItem`, it never writes a default,
   * so a reader can tell a missing key from one that does not read (a listed key that reads `null` has a value
   * the platform could not parse) without overwriting either.
   */
  public async readItem(key: string): Promise<unknown> {
    try {
      return await platform.getStoreValue(key)
    } catch (error) {
      log.error(`Failed to read from storage (key: ${key}):`, error)
      throw error
    }
  }

  /**
   * The stored text behind `key`, unparsed: `null` when nothing is stored, `undefined` when the platform cannot
   * tell (no `getStoreRaw`). A reader that sees `readItem` return `null` for a listed key uses it to tell a stored
   * `null` (or empty text) from text that does not parse.
   */
  public async readRawItem(key: string): Promise<string | null | undefined> {
    if (!platform.getStoreRaw) return undefined
    try {
      return await platform.getStoreRaw(key)
    } catch (error) {
      log.error(`Failed to read raw text from storage (key: ${key}):`, error)
      throw error
    }
  }

  public async removeItem(key: string): Promise<void> {
    return platform.delStoreValue(key)
  }

  public async getAll(): Promise<{ [key: string]: any }> {
    try {
      return await platform.getAllStoreValues()
    } catch (error) {
      log.error('Failed to read all values from storage:', error)
      throw error
    }
  }

  public async getAllKeys(): Promise<string[]> {
    try {
      return await platform.getAllStoreKeys()
    } catch (error) {
      log.error('Failed to read all keys from storage:', error)
      throw error
    }
  }

  public async setAll(data: { [key: string]: any }) {
    return platform.setAllStoreValues(data)
  }

  // (legacy comment)
  public async setBlob(key: string, value: string) {
    return platform.setStoreBlob(key, value)
  }
  public async getBlob(key: string): Promise<string | null> {
    try {
      return await platform.getStoreBlob(key)
    } catch (error) {
      log.error(`Failed to read blob from storage (key: ${key}):`, error)
      throw error
    }
  }
  public async delBlob(key: string) {
    return platform.delStoreBlob(key)
  }
  public async getBlobKeys(): Promise<string[]> {
    return platform.listStoreBlobKeys()
  }
  // subscribe(key: string, callback: any, initialValue: any): Promise<void>
}

import uniqBy from 'lodash/uniqBy'
import { StorageKey } from './StoreStorage'

/*
 * Keys that stay on this device. A settings export leaves them out, and an import never writes them, so an old
 * export that still holds them (even as `null`) leaves this device's copy untouched:
 * - the PM pilot's client mail, Asana records, drafts, questions and cursors (`pm-*`, `pm:records:*`; maintainer
 *   ruling, slice 10);
 * - approved knowledge, its migration record and connected sources (`knowledge`, `knowledge-migration`,
 *   `sources`). OKF import (ADR 0014) is how knowledge comes in, as proposals.
 */

const DEVICE_ONLY_KEYS: ReadonlySet<string> = new Set([
  StorageKey.Knowledge,
  StorageKey.KnowledgeMigration,
  StorageKey.Sources,
])

export function isDeviceOnlyKey(key: string): boolean {
  return key.startsWith('pm-') || key.startsWith('pm:') || DEVICE_ONLY_KEYS.has(key)
}

/** A copy of `data` without the device-only keys. */
export function omitDeviceOnlyKeys<T>(data: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !isDeviceOnlyKey(key)))
}

/**
 * What Settings > General's import writes, key by key: every entry except the chat list (merged separately),
 * the config version, `__` export metadata and the device-only keys.
 */
export function settingsImportEntries(importData: Record<string, unknown>): [string, unknown][] {
  return Object.entries(importData).filter(
    ([key]) =>
      key !== StorageKey.ChatSessionsList &&
      key !== StorageKey.ConfigVersion &&
      !key.startsWith('__') &&
      !isDeviceOnlyKey(key)
  )
}

/**
 * What the legacy import dialog hands to `setAll` (which writes key by key): this device's values overlaid with
 * the import, chat lists merged. Device-only keys are left out of both sides, so `setAll` never touches them, not
 * even to write this device's own value back (a corrupt document would come back as `null`).
 */
export function settingsImportMerge(
  previousData: Record<string, unknown>,
  importData: Record<string, unknown>
): Record<string, unknown> {
  const list = (data: Record<string, unknown>) => {
    const value = data[StorageKey.ChatSessionsList]
    return Array.isArray(value) ? value : []
  }
  return {
    ...omitDeviceOnlyKeys(previousData),
    ...omitDeviceOnlyKeys(importData),
    [StorageKey.ChatSessionsList]: uniqBy([...list(previousData), ...list(importData)], 'id'),
  }
}

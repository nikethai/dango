/*
 * Keys that stay on this device: the PM pilot's client mail, Asana records, drafts, questions and cursors (`pm-*`,
 * `pm:records:*`). A settings export leaves them out, and an import never writes them (maintainer ruling, slice 10).
 */

export function isDeviceOnlyKey(key: string): boolean {
  return key.startsWith('pm-') || key.startsWith('pm:')
}

/** A copy of `data` without the device-only keys. */
export function omitDeviceOnlyKeys<T>(data: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !isDeviceOnlyKey(key)))
}

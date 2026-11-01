import { describe, expect, it } from 'vitest'
import { notificationPermissionView, notificationSettingsUrl } from './system-settings'

describe('notificationPermissionView', () => {
  it('never claims "Permission granted" on desktop, where the plugin always says granted', () => {
    const view = notificationPermissionView({ desktop: true, os: 'Mac', permission: 'granted' })
    expect(view.label).toBe('macOS decides whether these show: System Settings › Notifications › Dango.')
    expect(view.settingsUrl).toBe(notificationSettingsUrl('Mac'))
    expect(view.canTest).toBe(true)
    expect(view.canRequest).toBe(false)
  })

  it('links to Windows notification settings on Windows, and only offers the test on Linux', () => {
    expect(notificationPermissionView({ desktop: true, os: 'Windows', permission: 'granted' }).settingsUrl).toBe(
      'ms-settings:notifications'
    )
    const linux = notificationPermissionView({ desktop: true, os: 'Linux', permission: 'granted' })
    expect(linux.settingsUrl).toBeUndefined()
    expect(linux.canTest).toBe(true)
  })

  it('keeps the real permission answer and Request permission off desktop', () => {
    expect(notificationPermissionView({ desktop: false, os: 'Unknown', permission: 'default' })).toEqual({
      label: 'Permission not requested',
      canTest: false,
      canRequest: true,
    })
    expect(notificationPermissionView({ desktop: false, os: 'Unknown', permission: 'granted' }).canTest).toBe(true)
  })

  it('offers nothing where notifications are unsupported', () => {
    expect(notificationPermissionView({ desktop: true, os: 'Mac', permission: 'unsupported' })).toEqual({
      label: 'Not supported on this platform',
      canTest: false,
      canRequest: false,
    })
  })
})

import { describe, expect, test } from 'vitest'
import { createPlatformCapabilities } from './capabilities'

describe('createPlatformCapabilities', () => {
  test('keeps Android layout, runtime, and supported features distinct', () => {
    const capabilities = createPlatformCapabilities({
      type: 'desktop',
      formFactor: 'mobile',
      buildPlatform: 'android',
    })

    expect(capabilities.isMobileLayout).toBe(true)
    expect(capabilities.isAndroidRuntime).toBe(true)
    expect(capabilities.supportsMcpBootstrap).toBe(true)
    expect(capabilities.supportsMcpStdio).toBe(false)
    expect(capabilities.supportsKnowledgeBase).toBe(false)
    expect(capabilities.supportsDesktopOnlySettings).toBe(false)
    expect(capabilities.supportsAgentSkillScan).toBe(false)
    expect(capabilities.supportsSystemNotifications).toBe(true)
    expect(capabilities.supportsImportedArchives).toBe(false)
    expect(capabilities.supportsProjectWorkspace).toBe(false)
    expect(capabilities.supportsWorkspaceExport).toBe(false)
    expect(capabilities.supportsSourceControl).toBe(false)
    expect(capabilities.supportsChangeReview).toBe(false)
    expect(capabilities.supportsLocalExecution).toBe(false)
    expect(capabilities.supportsManagedWorktrees).toBe(false)
    expect(capabilities.supportsCodexThreads).toBe(false)
  })

  test('enables desktop-only capabilities on desktop builds', () => {
    const capabilities = createPlatformCapabilities({
      type: 'desktop',
      formFactor: 'desktop',
      buildPlatform: 'unknown',
    })

    expect(capabilities.isMobileLayout).toBe(false)
    expect(capabilities.isAndroidRuntime).toBe(false)
    expect(capabilities.supportsMcpBootstrap).toBe(true)
    expect(capabilities.supportsMcpStdio).toBe(true)
    expect(capabilities.supportsKnowledgeBase).toBe(true)
    expect(capabilities.supportsDesktopOnlySettings).toBe(true)
    expect(capabilities.supportsAgentSkillScan).toBe(true)
    expect(capabilities.supportsSystemNotifications).toBe(true)
    expect(capabilities.supportsImportedArchives).toBe(true)
    expect(capabilities.supportsProjectWorkspace).toBe(true)
    expect(capabilities.supportsWorkspaceExport).toBe(true)
    expect(capabilities.supportsSourceControl).toBe(true)
    expect(capabilities.supportsChangeReview).toBe(true)
    expect(capabilities.supportsLocalExecution).toBe(false)
    expect(capabilities.supportsManagedWorktrees).toBe(false)
    expect(capabilities.supportsCodexThreads).toBe(true)
  })

  test('does not infer runtime support from mobile layout alone', () => {
    const capabilities = createPlatformCapabilities({
      type: 'mobile',
      formFactor: 'mobile',
      buildPlatform: 'ios',
    })

    expect(capabilities.isMobileLayout).toBe(true)
    expect(capabilities.isAndroidRuntime).toBe(false)
    expect(capabilities.supportsMcpBootstrap).toBe(false)
    expect(capabilities.supportsMcpStdio).toBe(false)
    expect(capabilities.supportsKnowledgeBase).toBe(false)
    expect(capabilities.supportsDesktopOnlySettings).toBe(false)
    expect(capabilities.supportsAgentSkillScan).toBe(false)
    expect(capabilities.supportsSystemNotifications).toBe(true)
    expect(capabilities.supportsImportedArchives).toBe(false)
    expect(capabilities.supportsProjectWorkspace).toBe(false)
    expect(capabilities.supportsWorkspaceExport).toBe(false)
    expect(capabilities.supportsSourceControl).toBe(false)
    expect(capabilities.supportsChangeReview).toBe(false)
    expect(capabilities.supportsLocalExecution).toBe(false)
    expect(capabilities.supportsManagedWorktrees).toBe(false)
    expect(capabilities.supportsCodexThreads).toBe(false)
  })
})

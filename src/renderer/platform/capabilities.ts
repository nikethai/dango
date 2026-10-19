import type { FormFactor, PlatformType } from './interfaces'

export interface PlatformCapabilityInput {
  type: PlatformType
  formFactor: FormFactor
  buildPlatform: 'unknown' | 'ios' | 'android' | 'web'
}

export interface PlatformCapabilities {
  isMobileLayout: boolean
  isAndroidRuntime: boolean
  supportsMcpBootstrap: boolean
  supportsMcpStdio: boolean
  supportsKnowledgeBase: boolean
  supportsDesktopOnlySettings: boolean
  supportsAgentSkillScan: boolean
  /** Local OS notifications (not remote push) */
  supportsSystemNotifications: boolean
  /** Vendor archive import (ChatGPT ZIP). Desktop only. */
  supportsImportedArchives: boolean
  /** Native directory Project bind/read/mutate (desktop Tauri only). */
  supportsProjectWorkspace: boolean
  supportsWorkspaceExport: boolean
  supportsSourceControl: boolean
  supportsChangeReview: boolean
  supportsLocalExecution: boolean
  supportsManagedWorktrees: boolean
  /** Read-only local Codex CLI threads broker (desktop Tauri only). */
  supportsCodexThreads: boolean
}

/**
 * Centralizes platform support decisions. Runtime capabilities deliberately do
 * not derive from formFactor, which controls layout only.
 */
export function createPlatformCapabilities({
  type,
  formFactor,
  buildPlatform,
}: PlatformCapabilityInput): PlatformCapabilities {
  const isAndroidRuntime = buildPlatform === 'android'
  const isDesktopRuntime = type === 'desktop' && !isAndroidRuntime
  // Local OS notifications: desktop Tauri, Capacitor mobile shells, and web secure contexts.
  // Runtime still checks permission APIs; this is capability-level support only.
  const supportsSystemNotifications = type === 'desktop' || type === 'mobile' || type === 'web' || isAndroidRuntime

  return {
    isMobileLayout: formFactor === 'mobile',
    isAndroidRuntime,
    // Tauri Android provides the desktop IPC transport, so HTTP MCP remains available.
    supportsMcpBootstrap: type === 'desktop',
    // Android cannot spawn the local child processes required by stdio MCP servers.
    supportsMcpStdio: isDesktopRuntime,
    supportsKnowledgeBase: isDesktopRuntime,
    supportsDesktopOnlySettings: isDesktopRuntime,
    supportsAgentSkillScan: isDesktopRuntime,
    supportsSystemNotifications,
    supportsImportedArchives: isDesktopRuntime,
    supportsProjectWorkspace: isDesktopRuntime,
    supportsWorkspaceExport: isDesktopRuntime,
    supportsSourceControl: isDesktopRuntime,
    supportsChangeReview: isDesktopRuntime,
    supportsLocalExecution: false,
    supportsManagedWorktrees: false,
    supportsCodexThreads: isDesktopRuntime,
  }
}

import { atom } from 'jotai'
import { atomFamily, atomWithStorage } from 'jotai/utils'
import type React from 'react'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import platform from '@/platform'
import type { KnowledgeBase, MessagePicture, Toast } from '../../../shared/types'
import type { PreConstructedMessageState } from '../../types/input-box'

// Input box related state
const defaultPreConstructedMessageState = (): PreConstructedMessageState => ({
  text: '',
  pictureKeys: [],
  attachments: [],
  links: [],
  preprocessedFiles: [],
  preprocessedLinks: [],
  preprocessingStatus: {
    files: {},
    links: {},
  },
  preprocessingPromises: {
    files: new Map<string, Promise<unknown>>(),
    links: new Map<string, Promise<unknown>>(),
  },
})

export const inputBoxLinksFamily = atomFamily((_sessionId: string) => atom<{ url: string }[]>([]))
export const inputBoxPreConstructedMessageFamily = atomFamily((_sessionId: string) =>
  atom(defaultPreConstructedMessageState())
)

/** One-shot text prefill requested by the desktop clipboard shortcut. */
export const inputBoxPrefillTextFamily = atomFamily((_sessionId: string) => atom<string | null>(null))

/** Most picture keys a quick-window capture keeps (oldest dropped first). */
export const QUICK_CAPTURE_MAX_PICTURES = 8

export type QuickPendingCapture = { text: string | null; pictureKeys: string[] }

/**
 * Clipboard text / screenshots captured by the desktop shell while the quick window is the target.
 * The quick panel consumes and clears it; the main window's composer atoms are never touched.
 */
export const quickPendingCaptureAtom = atom<QuickPendingCapture>({ text: null, pictureKeys: [] })

/**
 * Composer → statusline bridge for token menu (compress / auto-compaction / breakdown).
 * Written by InputBox; read by SessionStatusBar so telemetry lives on the statusline only.
 */
export type ComposerTokenMenuState = {
  sessionId: string
  currentInputTokens: number
  contextTokens: number
  totalTokens: number
  isCalculating?: boolean
  pendingTasks?: number
  totalContextMessages?: number
  contextWindow?: number
  currentMessageCount?: number
  maxContextMessageCount?: number
  autoCompactionEnabled?: boolean
  isCompacting?: boolean
  contextWindowKnown?: boolean
  onCompressClick?: () => void
  onAutoCompactionChange?: (enabled: boolean) => void
}

export const composerTokenMenuAtom = atom<ComposerTokenMenuState | null>(null)

// Atom to store collapsed state of providers
export const collapsedProvidersAtom = atomWithStorage<Record<string, boolean>>('collapsedProviders', {})

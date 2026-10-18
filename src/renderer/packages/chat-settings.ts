import { readCostWarningUsd, readShowThinking, type ShowThinking } from '@shared/types/settings'

// The only place slice 6 reads `showThinking`, `costWarningUsd` and scope `kind`.
// Show-thinking and cost-warning delegate to the settings readers (single source of truth).

export function getShowThinking(settings: unknown): ShowThinking {
  return readShowThinking((settings as { showThinking?: unknown } | null | undefined)?.showThinking)
}

export function getCostWarningUsd(settings: unknown): number {
  return readCostWarningUsd((settings as { costWarningUsd?: unknown } | null | undefined)?.costWarningUsd)
}

export function scopeKindOf(project: unknown): 'project' | 'client' {
  return (project as { kind?: unknown } | null | undefined)?.kind === 'client' ? 'client' : 'project'
}

import { createFileRoute } from '@tanstack/react-router'
import { MemoryPrivacyPage } from '@/components/settings/privacy'

export const Route = createFileRoute('/settings/privacy')({
  component: MemoryPrivacyPage,
})

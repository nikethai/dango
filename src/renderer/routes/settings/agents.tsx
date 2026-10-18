import { createFileRoute } from '@tanstack/react-router'
import { AgentsSettings } from '@/components/settings/agents'

export const Route = createFileRoute('/settings/agents')({
  component: RouteComponent,
})

export function RouteComponent() {
  return <AgentsSettings />
}

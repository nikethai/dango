import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/copilots')({
  // Copilots moved under Settings as Agents — keep legacy path as redirect
  beforeLoad: () => {
    throw redirect({ to: '/settings/agents' })
  },
  component: () => null,
})

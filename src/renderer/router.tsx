import { createHashHistory, createRouter, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import platform from './platform'
import { routeTree } from './routeTree.gen'
import { isSettingsPath } from './utils/settings-navigation'

// Create a new router instance
export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: () => {
    const navigate = useNavigate()

    useEffect(() => {
      navigate({ to: '/', replace: true }) // (legacy)
    }, [navigate])

    return null
  },
  history: platform.type === 'web' ? undefined : createHashHistory(),
})

// The last page outside Settings, where closing Settings returns (any entry: links, the menu, deep links).
let lastLocationOutsideSettings: { pathname: string; href: string } | undefined
function rememberLocation(location: { pathname: string; href: string }) {
  if (!isSettingsPath(location.pathname)) lastLocationOutsideSettings = location
}
rememberLocation(router.state.location)
router.subscribe('onResolved', ({ toLocation }) => rememberLocation(toLocation))

export function getLastLocationOutsideSettings() {
  return lastLocationOutsideSettings
}

// Register the router instance for type safety
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

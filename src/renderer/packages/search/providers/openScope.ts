/** Opens a scope page on a tab (Everywhere's page ignores the tab). The router is loaded lazily. */
export async function openScopeTab(scopeId: string, tab: 'knowledge' | 'files'): Promise<void> {
  const { router } = await import('@/router')
  await router.navigate({ to: '/scope/$scopeId', params: { scopeId }, search: { tab } })
}

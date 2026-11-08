import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { z } from 'zod'
import { BuiltinServersSection } from '@/components/settings/mcp/BuiltinServersSection'
import CustomServersSection from '@/components/settings/mcp/CustomServersSection'
import { parseServerFromJson } from '@/components/settings/mcp/utils'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsSection } from '@/components/settings/SettingsSection'
import type { MCPServerConfig } from '@/packages/mcp/types'
import { platformCapabilities } from '@/platform'
import { decodeBase64 } from '@/utils/base64'

const searchSchema = z.object({
  install: z.string().optional(), // b64 encoded config
})

export const Route = createFileRoute('/settings/mcp')({
  component: RouteComponent,
  validateSearch: zodValidator(searchSchema),
})

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const [installConfig, setInstallConfig] = useState<MCPServerConfig | undefined>(undefined)

  // Handle install parameter from search params
  useEffect(() => {
    if (searchParams.install) {
      try {
        const config = parseServerFromJson(decodeBase64(searchParams.install))
        if (config && (!platformCapabilities.supportsMcpStdio && config.transport.type === 'stdio')) {
          toast.error(t('Local stdio MCP servers are unavailable on Android'))
        } else {
          setInstallConfig(config)
        }
      } catch (err) {
        console.error(err)
      }
      // Clear search params immediately after reading
      navigate({
        to: '/settings/mcp',
        search: {},
        replace: true,
      })
    }
  }, [searchParams.install, navigate, t])

  return (
    <SettingsPage wide>
      <SettingsPageHeader
        title={t('MCP')}
        description={t('Model Context Protocol servers extend what tools the assistant can use.')}
      />
      <SettingsSection title={t('Built-in')}>
        <BuiltinServersSection />
      </SettingsSection>
      <SettingsSection title={t('Custom servers')}>
        <CustomServersSection installConfig={installConfig} />
      </SettingsSection>
    </SettingsPage>
  )
}

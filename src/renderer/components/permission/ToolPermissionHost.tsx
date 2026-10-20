import { useCallback } from 'react'
import { type PermissionChoice, resolvePermission, usePermissionHead } from '@/packages/tool-permission'
import { ToolPermissionSheet } from './ToolPermissionSheet'

/** Shows this window's permission queue one request at a time. Mounted once at the root (main and quick window). */
export function ToolPermissionHost() {
  const head = usePermissionHead()
  const headId = head?.id
  const onChoose = useCallback(
    (choice: PermissionChoice) => {
      if (headId) resolvePermission(headId, choice)
    },
    [headId]
  )
  return <ToolPermissionSheet request={head} onChoose={onChoose} />
}

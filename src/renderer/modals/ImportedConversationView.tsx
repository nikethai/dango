import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { Button, Checkbox, Stack, Text } from '@mantine/core'
import type { ImportedConversation, ImportedMessage, ImportedSource } from '@shared/imported-history'
import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { DeleteImportedSourceSheet } from '@/components/imported-history'
import {
  buildHandoffPreview,
  continueImportedConversation,
  deleteImportedSourceAndReconcile,
} from '@/packages/imported-history'
import * as chatStore from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { switchCurrentSession } from '@/stores/sessionActions'

type Props = {
  source: ImportedSource
  conversation: ImportedConversation
}

const ImportedConversationView = NiceModal.create(({ source, conversation }: Props) => {
  const modal = useModal()
  const { t } = useTranslation()
  // While the confirm sheet is up (or the delete runs) the viewer is closed, so only one focus trap is live.
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const deletingRef = useRef(false)
  // After a cancelled or failed delete the viewer comes back with focus on its delete button.
  const [focusDelete, setFocusDelete] = useState(false)
  // What had focus when the viewer opened, so focus can go back there once the source is deleted.
  const openerRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    if (!modal.visible) return
    openerRef.current = document.activeElement as HTMLElement | null
    setFocusDelete(false)
  }, [modal.visible])
  const [selectedIds, setSelectedIds] = useState<string[]>(() => conversation.messages.map((m) => m.id))
  const selectedMessages = useMemo(
    () => conversation.messages.filter((message) => selectedIds.includes(message.id)),
    [conversation.messages, selectedIds]
  )
  const target = lastUsedModelStore.getState().chat
  const preview = buildHandoffPreview({
    sourceId: source.id,
    conversation,
    selectedMessages,
    recentTurnCount: 2,
    targetProvider: target?.provider,
    targetModelId: target?.modelId,
  })

  const toggle = (message: ImportedMessage) => {
    setSelectedIds((current) =>
      current.includes(message.id) ? current.filter((id) => id !== message.id) : [...current, message.id]
    )
  }

  const onContinue = async () => {
    const session = await continueImportedConversation({
      sourceId: source.id,
      conversation,
      selectedMessages,
      recentTurnCount: 2,
      targetProvider: target?.provider,
      targetModelId: target?.modelId,
    })
    switchCurrentSession(session.id)
    modal.hide()
  }

  const onDelete = async () => {
    if (deletingRef.current) return
    deletingRef.current = true
    setDeleting(true)
    try {
      await deleteImportedSourceAndReconcile(source.id, {
        listNativeSessions: async () => {
          const metas = await chatStore.listSessionsMeta()
          const sessions = await Promise.all(metas.map((meta) => chatStore.getSession(meta.id)))
          return sessions.filter((session): session is NonNullable<typeof session> => Boolean(session))
        },
        persistNativeSession: async (session) => {
          await chatStore.updateSessionWithMessages(session.id, () => session)
        },
      })
      modal.hide()
      setFocusDelete(false)
      const opener = openerRef.current
      if (opener?.isConnected && opener !== document.body) opener.focus()
      else document.getElementById('main')?.focus()
    } catch (error) {
      console.error('Failed to delete imported source', error)
      setFocusDelete(true)
    } finally {
      deletingRef.current = false
      setDeleting(false)
    }
  }

  const viewerHidden = confirming || deleting

  return (
    <>
      <AdaptiveModal
        opened={modal.visible && !viewerHidden}
        onClose={() => modal.hide()}
        // Handing over to the confirm sheet must not pull focus back to the viewer's opener.
        returnFocus={!viewerHidden}
        centered
        title={conversation.title}
      >
        <Stack gap="sm" p="sm" className="max-h-[70vh] overflow-auto">
          <Text size="xs">
            {t('Imported from {{filename}} · ChatGPT export · read-only', { filename: source.originalFilename })}
          </Text>
          {conversation.messages.map((message) => (
            <Checkbox
              key={message.id}
              checked={selectedIds.includes(message.id)}
              label={`${message.role}: ${message.text.slice(0, 280)}`}
              onChange={() => toggle(message)}
            />
          ))}
          <Text size="sm">
            {t('Destination')}: {preview.provider || '—'} / {preview.modelId || '—'} · {preview.estimatedTokens}{' '}
            {t('tokens')}
          </Text>
          <Text size="sm">{preview.disclosure}</Text>
          {preview.omittedCount > 0 ? (
            <Text size="xs">
              {t('Omitted')}: {preview.omittedReasons.join(', ')}
            </Text>
          ) : null}
          <Button onClick={() => void onContinue()}>{t('Continue in Dango')}</Button>
          <Button
            color="red"
            variant="light"
            data-autofocus={focusDelete || undefined}
            disabled={deleting}
            onClick={() => setConfirming(true)}
          >
            {t('Delete imported source')}
          </Button>
          <Button variant="default" onClick={() => modal.hide()}>
            {t('Close')}
          </Button>
        </Stack>
      </AdaptiveModal>
      <DeleteImportedSourceSheet
        filename={source.originalFilename}
        conversationCount={source.conversations.length}
        opened={modal.visible && confirming}
        onClose={() => {
          setConfirming(false)
          setFocusDelete(true)
        }}
        onConfirm={() => void onDelete()}
      />
    </>
  )
})

export default ImportedConversationView

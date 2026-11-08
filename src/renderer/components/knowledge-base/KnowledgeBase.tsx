import { Button, Flex, Group, Pill, Stack, Text } from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import type { KnowledgeBase, ProviderModelInfo } from '@shared/types'
import type { DocumentParserConfig, DocumentParserType } from '@shared/types/settings'
import {
  isLocalKnowledgeBaseModel,
  LOCAL_E5_SMALL_MODEL,
  parseKnowledgeBaseModelString,
} from '@shared/utils/knowledge-base-model-parser'
import { IconAlertTriangle, IconBooks, IconPlus } from '@tabler/icons-react'
import compact from 'lodash/compact'
import flatten from 'lodash/flatten'
import type React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsCallout } from '@/components/settings/SettingsCallout'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useProviders } from '@/hooks/useProviders'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'
import { trackEvent } from '@/utils/track'
import { ScalableIcon } from '../common/ScalableIcon'
import { Modal } from '../layout/Overlay'
import KnowledgeBaseDocuments from './KnowledgeBaseDocuments'
import {
  DocumentParserDisplay,
  DocumentParserSelector,
  KnowledgeBaseFormActions,
  KnowledgeBaseModelSelectors,
  KnowledgeBaseNameInput,
} from './KnowledgeBaseForm'

interface ModelPillProps {
  modelValue: string | null | undefined
  formatModelName: (model: string) => string
  isProviderAvailable: (model: string) => boolean
  type: 'embedding' | 'rerank' | 'vision'
  t: (key: string) => string
}

const ModelPill: React.FC<ModelPillProps> = ({ modelValue, formatModelName, isProviderAvailable, type, t }) => {
  const isEmbedding = type === 'embedding'
  const hasModel = !!modelValue
  const modelUnavailable = useMemo(
    () => !hasModel || !isProviderAvailable(modelValue),
    [hasModel, isProviderAvailable, modelValue]
  )
  const getColor = () => {
    if (!hasModel) return 'dimmed'
    if (modelUnavailable) return 'red'
    return ''
  }

  const getIcon = () => {
    if (!hasModel || isProviderAvailable(modelValue)) return null
    return <ScalableIcon icon={IconAlertTriangle} size={12} color="red" title={t('Provider unavailable')} />
  }

  const maxWidth = isEmbedding ? 200 : 150

  const modelText = useMemo(
    () => (hasModel ? formatModelName(modelValue) : t('None')),
    [hasModel, modelValue, formatModelName, t]
  )

  return (
    <Pill style={{ display: 'flex', alignItems: 'center' }}>
      <Flex align="center" gap="xs" maw={maxWidth} h={'100%'}>
        <Text
          c={getColor()}
          size="xs"
          title={modelText}
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
          }}
        >
          {modelText}
        </Text>
        {getIcon()}
      </Flex>
    </Pill>
  )
}

const KnowledgeBasePage: React.FC = () => {
  const { t } = useTranslation()
  const [kbList, setKbList] = useState<KnowledgeBase[]>([])
  const [newKbName, setNewKbName] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const customProviders = useSettingsStore((state) => state.customProviders)

  const [newEmbeddingModel, setNewEmbeddingModel] = useState<string | null>(LOCAL_E5_SMALL_MODEL)
  const [newRerankModel, setNewRerankModel] = useState<string | null>(null)
  const [newVisionModel, setNewVisionModel] = useState<string | null>(null)
  const [newDocumentParser, setNewDocumentParser] = useState<DocumentParserConfig>({ type: 'local' })
  const [editKb, setEditKb] = useState<(Partial<KnowledgeBase> & { id: number }) | null>(null)
  const [editRerankModel, setEditRerankModel] = useState<string | null>(null)
  const [editVisionModel, setEditVisionModel] = useState<string | null>(null)
  const [deleteConfirmKb, setDeleteConfirmKb] = useState<(Partial<KnowledgeBase> & { id: number }) | null>(null)
  const [isUnsupportedPlatform, setIsUnsupportedPlatform] = useState(false)

  const { providers } = useProviders()

  const getModelList = useCallback(
    (filter: (model: ProviderModelInfo) => boolean) => {
      return compact(
        flatten(
          providers.map((provider) => {
            return provider.models?.filter(filter).map((model) => {
              return {
                label: `${provider.name} | ${model.nickname || model.modelId}`,
                value: `${provider.id}:${model.modelId}`,
              }
            })
          })
        )
      )
    },
    [providers]
  )

  const embeddingModelList = useMemo(() => {
    const local = [
      {
        label: 'On-device | multilingual-e5-small',
        value: LOCAL_E5_SMALL_MODEL,
      },
    ]
    const remote = getModelList((model) => !!model.type && model.type === 'embedding')
    return [...local, ...remote]
  }, [getModelList])

  const rerankModelList = useMemo(() => {
    return getModelList((model) => model.type === 'rerank')
  }, [getModelList])

  const visionModelList = useMemo(() => {
    return getModelList((model) => !!model.capabilities?.includes('vision'))
  }, [getModelList])

  const knowledgeBaseController = useMemo(() => {
    return platform.getKnowledgeBaseController()
  }, [])

  const getProviderName = useCallback(
    (providerId: string) => {
      if (SystemProviders().some((it) => it.id === providerId)) {
        return SystemProviders().find((it) => it.id === providerId)?.name
      }

      const customProvider = customProviders?.find((it) => it.id === providerId)
      if (customProvider) {
        return customProvider.name
      }

      return providerId
    },
    [customProviders]
  )

  const getModelName = useCallback(
    (providerId: string, modelId: string) => {
      const provider = providers.find((it) => it.id === providerId)
      if (provider) {
        const model = provider.models?.find((it) => it.modelId === modelId)
        if (model) {
          return model.nickname || model.modelId
        }
      }
    },
    [providers]
  )

  const isProviderAvailable = useCallback(
    (modelString: string) => {
      if (isLocalKnowledgeBaseModel(modelString)) return true
      const parsed = parseKnowledgeBaseModelString(modelString)
      if (!parsed) return false
      return providers.some((provider) => provider.id === parsed.providerId)
    },
    [providers]
  )

  function formatModelName(model: string) {
    const parsed = parseKnowledgeBaseModelString(model)
    if (!parsed) return t('Unknown')
    const { providerId, modelId } = parsed
    if (providerId === 'local') {
      return `On-device | ${modelId}`
    }
    const providerName = getProviderName(providerId)
    const modelName = getModelName(providerId, modelId) || modelId
    return `${providerName} | ${modelName}`
  }

  function formatParserType(parserType?: DocumentParserType): string {
    switch (parserType) {
      case 'mineru':
        return 'MinerU'
      default:
        return t('Local')
    }
  }

  const fetchKbList = useCallback(async () => {
    if (isUnsupportedPlatform) return
    try {
      const list = await knowledgeBaseController.list()
      if (list) {
        setKbList(list)
      }
    } catch (error) {
      toast.error(t('Failed to fetch knowledge base list, Error: {{error}}', { error: error }))
    }
  }, [knowledgeBaseController, isUnsupportedPlatform, t])

  useEffect(() => {
    void fetchKbList()
  }, [fetchKbList])

  // Check platform compatibility
  useEffect(() => {
    const checkPlatform = async () => {
      try {
        const platformName = await platform.getPlatform()
        const arch = await platform.getArch()
        const isWin32Arm64 = platformName === 'win32' && arch === 'arm64'
        setIsUnsupportedPlatform(isWin32Arm64)
      } catch (error) {
        console.error('Failed to check platform compatibility:', error)
      }
    }
    void checkPlatform()
  }, [])

  const createKb = async () => {
    if (!newKbName || !newEmbeddingModel) return

    const embeddingModel = newEmbeddingModel
    const rerankModel = newRerankModel || ''
    const visionModel = newVisionModel || ''
    const documentParser: DocumentParserConfig | undefined = newDocumentParser

    try {
      await knowledgeBaseController.create({
        name: newKbName,
        embeddingModel: embeddingModel,
        rerankModel: rerankModel,
        visionModel: visionModel,
        documentParser: documentParser,
        providerMode: 'custom',
      })

      trackEvent('knowledge_base_created', {
        provider_mode: 'custom',
        embedding_model: embeddingModel,
        rerank_model: rerankModel || null,
        vision_model: visionModel || null,
        document_parser: documentParser?.type || 'global',
        knowledge_base_name: newKbName,
      })

      // Reset form
      setNewKbName('')
      setNewEmbeddingModel(LOCAL_E5_SMALL_MODEL)
      setNewRerankModel(null)
      setNewVisionModel(null)
      setNewDocumentParser({ type: 'local' })
      setShowCreate(false)
      await fetchKbList()
    } catch (e) {
      toast.error(t('Failed to create knowledge base, Error: {{error}}', { error: e }))
    }
  }

  const handleEditKb = (kb: KnowledgeBase) => {
    setEditKb(kb)
    setEditRerankModel(kb.rerankModel ? `${kb.rerankModel}` : null)
    setEditVisionModel(kb.visionModel ? `${kb.visionModel}` : null)
  }

  const handleSaveEditKb = async () => {
    if (!editKb) return

    try {
      await knowledgeBaseController.update({
        id: editKb.id,
        name: editKb.name,
        rerankModel: editRerankModel || '',
        visionModel: editVisionModel || '',
      })
      setEditKb(null)
      setEditRerankModel(null)
      setEditVisionModel(null)
      await fetchKbList()
    } catch (e) {
      toast.error(t('Failed to update knowledge base, Error: {{error}}', { error: e }))
    }
  }

  const handleDeleteKb = async () => {
    if (!deleteConfirmKb) return
    try {
      await knowledgeBaseController.delete(deleteConfirmKb.id)
      setDeleteConfirmKb(null)
      setEditKb(null) // Close edit modal if it's open
      await fetchKbList()
    } catch (error) {
      console.error('Failed to delete knowledge base:', error)
    }
  }

  return (
    <SettingsPage wide>
      <SettingsPageHeader
        title={t('Documents')}
        description={t('Attach documents so the assistant can retrieve context during chats.')}
        actions={
          !isUnsupportedPlatform ? (
            <Button
              variant="default"
              size="sm"
              leftSection={<ScalableIcon icon={IconPlus} size={16} />}
              onClick={() => setShowCreate(true)}
            >
              {t('Add')}
            </Button>
          ) : undefined
        }
      />

      {isUnsupportedPlatform && (
        <SettingsCallout title={t('Platform Not Supported')} tone="warning">
          {t(
            'Knowledge Base functionality is not available on Windows ARM64 due to library compatibility issues. This feature is supported on Windows x64, macOS, and Linux.'
          )}
        </SettingsCallout>
      )}

      <Modal opened={showCreate} onClose={() => setShowCreate(false)} title={t('Create Knowledge Base')} centered>
        <Stack gap="md">
          <KnowledgeBaseNameInput value={newKbName} onChange={setNewKbName} autoFocus />

          <DocumentParserSelector parserConfig={newDocumentParser} onParserConfigChange={setNewDocumentParser} />
          <KnowledgeBaseModelSelectors
            embeddingModelList={embeddingModelList}
            rerankModelList={rerankModelList}
            visionModelList={visionModelList}
            embeddingModel={newEmbeddingModel}
            rerankModel={newRerankModel}
            visionModel={newVisionModel}
            onEmbeddingModelChange={setNewEmbeddingModel}
            onRerankModelChange={setNewRerankModel}
            onVisionModelChange={setNewVisionModel}
          />
          {newEmbeddingModel && !isLocalKnowledgeBaseModel(newEmbeddingModel) && (
            <Text size="xs" c="orange">
              {t(
                'This embedding model sends document text off this device. Prefer On-device | multilingual-e5-small to keep files local.'
              )}
            </Text>
          )}

          <KnowledgeBaseFormActions
            onCancel={() => setShowCreate(false)}
            onConfirm={createKb}
            confirmText={t('Create')}
            isConfirmDisabled={!newKbName || !newEmbeddingModel}
          />
        </Stack>
      </Modal>
      <Modal opened={!!editKb} onClose={() => setEditKb(null)} title={t('Edit Knowledge Base')} centered>
        <Stack gap="md">
          <KnowledgeBaseNameInput
            value={editKb?.name || ''}
            onChange={(value) => editKb && setEditKb({ ...editKb, name: value })}
            label={t('Name') as string}
          />
          <DocumentParserDisplay parserType={editKb?.documentParser?.type} />
          <KnowledgeBaseModelSelectors
            embeddingModelList={embeddingModelList}
            rerankModelList={rerankModelList}
            visionModelList={visionModelList}
            embeddingModel={editKb ? `${editKb.embeddingModel}` : ''}
            rerankModel={editRerankModel}
            visionModel={editVisionModel}
            onRerankModelChange={setEditRerankModel}
            onVisionModelChange={setEditVisionModel}
            isEmbeddingDisabled
          />
          <KnowledgeBaseFormActions
            onCancel={() => setEditKb(null)}
            onConfirm={handleSaveEditKb}
            confirmText={t('Save')}
            showDelete
            onDelete={() => setDeleteConfirmKb(editKb)}
          />
        </Stack>
      </Modal>
      <Modal
        opened={!!deleteConfirmKb}
        onClose={() => setDeleteConfirmKb(null)}
        title={t('Delete Knowledge Base')}
        centered
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            {t('Are you sure you want to delete the knowledge base')} "{deleteConfirmKb?.name}"?
          </Text>
          <Text size="sm" c="chatbox-tertiary">
            {t('This action cannot be undone. All documents and their embeddings will be permanently deleted.')}
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setDeleteConfirmKb(null)}>
              {t('Cancel')}
            </Button>
            <Button color="red" onClick={handleDeleteKb}>
              {t('Delete')}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {!isUnsupportedPlatform &&
        (kbList.length === 0 ? (
          <SettingsSection>
            <SettingsCard className="settings-kb-empty">
              <div className="settings-kb-empty-inner">
                <div className="settings-kb-empty-icon" aria-hidden>
                  <ScalableIcon icon={IconBooks} size={28} />
                </div>
                <Text fw={600} size="md" className="settings-kb-empty-title">
                  {t('No knowledge bases yet')}
                </Text>
                <Text size="sm" c="chatbox-tertiary" className="settings-kb-empty-desc text-pretty">
                  {t(
                    'Create a knowledge base, add documents, and the assistant can pull relevant context into chats.'
                  )}
                </Text>
                <Button
                  variant="filled"
                  size="sm"
                  leftSection={<ScalableIcon icon={IconPlus} size={16} />}
                  onClick={() => setShowCreate(true)}
                >
                  {t('Create knowledge base')}
                </Button>
              </div>
            </SettingsCard>
          </SettingsSection>
        ) : (
          <SettingsSection title={t('Your libraries')}>
            <Stack gap="md">
              {kbList.map((kb) => (
                <SettingsCard key={kb.id}>
                  <div className="settings-card-fields">
                    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="md">
                      <Stack gap={6} className="min-w-0 flex-1">
                        <Text fw={600} size="sm" className="settings-list-row-title">
                          {kb.name}
                        </Text>
                        <Group gap={6} wrap="wrap" align="center">
                          <Text size="xs" c="chatbox-tertiary">
                            {t('Parser')}
                          </Text>
                          <Pill size="sm">{formatParserType(kb.documentParser?.type)}</Pill>
                          <Text size="xs" c="chatbox-tertiary">
                            {t('Embedding')}
                          </Text>
                          <ModelPill
                            modelValue={kb.embeddingModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="embedding"
                            t={t}
                          />
                          <Text size="xs" c="chatbox-tertiary">
                            {t('Rerank')}
                          </Text>
                          <ModelPill
                            modelValue={kb.rerankModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="rerank"
                            t={t}
                          />
                          <Text size="xs" c="chatbox-tertiary">
                            {t('Vision')}
                          </Text>
                          <ModelPill
                            modelValue={kb.visionModel}
                            formatModelName={formatModelName}
                            isProviderAvailable={isProviderAvailable}
                            type="vision"
                            t={t}
                          />
                        </Group>
                      </Stack>
                      <Button size="compact-sm" variant="default" onClick={() => handleEditKb(kb)} className="shrink-0">
                        {t('Edit')}
                      </Button>
                    </Group>
                    <KnowledgeBaseDocuments knowledgeBase={kb} />
                  </div>
                </SettingsCard>
              ))}
            </Stack>
          </SettingsSection>
        ))}
    </SettingsPage>
  )
}

export default KnowledgeBasePage

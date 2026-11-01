import {
  ActionIcon,
  Box,
  Button,
  Flex,
  Loader,
  Menu,
  ScrollArea,
  Stack,
  Text,
  Textarea,
  UnstyledButton,
} from '@mantine/core'
import type { ComfyUIGenerationParams } from '@shared/providers/definitions/models/comfyui-types'
import type { ImageGeneration } from '@shared/types'
import { ModelProviderEnum } from '@shared/types'
import {
  IconArrowUp,
  IconAspectRatio,
  IconChevronRight,
  IconHistory,
  IconPhoto,
  IconPlus,
  IconSparkles,
} from '@tabler/icons-react'
import { zodValidator } from '@tanstack/zod-adapter'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { type ClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ImageModelSelect } from '@/components/ImageModelSelect'
import Page from '@/components/layout/Page'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getLogger } from '@/lib/utils'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import {
  cancelGeneration,
  createAndGenerate,
  removeQueuedGeneration,
  resumeQueuedGenerations,
  retryGeneration,
} from '@/stores/imageGenerationActions'
import {
  deleteRecord,
  IMAGE_GEN_LIST_QUERY_KEY,
  imageGenerationStore,
  useActiveGenerationId,
  useCurrentRecordId,
  useImageGenerationHistory,
  useImageGenerationRecord,
  useQueuedGenerationIds,
} from '@/stores/imageGenerationStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { queryClient } from '@/stores/queryClient'
import { listAvailableImageModels } from '@/utils/available-image-models'
import { extractClipboardImages } from '@/utils/clipboardImages'
import {
  blobToDataUrl,
  COMFYUI_IMAGE_MODEL_IDS,
  getRatioOptionsForModel,
  HISTORY_PANEL_WIDTH,
  IMAGE_MODEL_FALLBACK_NAMES,
  MAX_REFERENCE_IMAGES,
} from './-components/constants'
import { ComfyUIControls } from './-components/ComfyUIControls'
import { EmptyState } from './-components/EmptyState'
import { GeneratedImagesGallery } from './-components/GeneratedImagesGallery'
import { HistoryPanel } from './-components/HistoryPanel'
import { ImageGenerationErrorTips } from './-components/ImageGenerationErrorTips'
import { MobileHistoryDrawer, MobileModelDrawer, MobileRatioDrawer } from './-components/MobileDrawers'
import { PromptDisplay } from './-components/PromptDisplay'
import { ReferenceImagesPreview } from './-components/ReferenceImagesPreview'
import { LoadingShimmer } from './-components/Shimmer'

const log = getLogger('image-creator')

export const Route = createFileRoute('/image-creator/')({
  component: ImageCreatorPage,
  validateSearch: zodValidator(
    z.object({
      prompt: z.string().optional(),
    })
  ),
})

/* ============================================
   Input Toolbar (Model/Ratio/Reference buttons)
   ============================================ */

interface InputToolbarProps {
  isSmallScreen: boolean
  modelDisplayName: string
  selectedRatio: string
  ratioOptions: string[]
  onModelDrawerOpen: () => void
  onRatioDrawerOpen: () => void
  onRatioSelect: (ratio: string) => void
  onModelSelect: (provider: string, model: string) => void
  onAddReference: () => void
  onNewCreation: () => void
}

function InputToolbar({
  isSmallScreen,
  modelDisplayName,
  selectedRatio,
  ratioOptions,
  onModelDrawerOpen,
  onRatioDrawerOpen,
  onRatioSelect,
  onModelSelect,
  onAddReference,
  onNewCreation,
}: InputToolbarProps) {
  const { t } = useTranslation()

  return (
    <Flex align="center" gap={0} className="shrink-0 w-full" justify="space-between">
      {/* Left Group: Model, Ratio, Reference */}
      <Flex align="center" gap={0}>
        {/* Model Select */}
        {isSmallScreen ? (
          <UnstyledButton
            onClick={onModelDrawerOpen}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
          >
            <IconSparkles size={16} className="text-[var(--chatbox-tint-secondary)]" />
            <Text size="sm" className="text-[var(--chatbox-tint-secondary)] max-w-[120px] truncate">
              {modelDisplayName}
            </Text>
            <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
          </UnstyledButton>
        ) : (
          <ImageModelSelect onSelect={onModelSelect}>
            <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
              <IconSparkles size={16} className="text-[var(--chatbox-tint-secondary)]" />
              <Text size="sm" className="text-[var(--chatbox-tint-secondary)] max-w-[120px] truncate">
                {modelDisplayName}
              </Text>
              <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
            </UnstyledButton>
          </ImageModelSelect>
        )}

        {/* Ratio Select */}
        {isSmallScreen ? (
          <UnstyledButton
            onClick={onRatioDrawerOpen}
            className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
          >
            <IconAspectRatio size={16} className="text-[var(--chatbox-tint-secondary)]" />
            <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
              {selectedRatio}
            </Text>
            <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
          </UnstyledButton>
        ) : (
          <Menu position="top" withinPortal shadow="md" radius="lg">
            <Menu.Target>
              <UnstyledButton className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors">
                <IconAspectRatio size={16} className="text-[var(--chatbox-tint-secondary)]" />
                <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
                  {selectedRatio}
                </Text>
                <IconChevronRight size={14} className="text-[var(--chatbox-tint-tertiary)] rotate-90" />
              </UnstyledButton>
            </Menu.Target>
            <Menu.Dropdown className="!rounded-2xl" style={{ minWidth: 100 }}>
              {ratioOptions.map((ratio) => (
                <Menu.Item key={ratio} onClick={() => onRatioSelect(ratio)} className="!rounded-lg">
                  <Text size="sm" fw={500} ta="center">
                    {ratio}
                  </Text>
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        )}

        {/* Reference Image Button */}
        <UnstyledButton
          onClick={onAddReference}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors"
        >
          <IconPhoto size={16} className="text-[var(--chatbox-tint-secondary)]" />
          <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
            {t('Upload')}
          </Text>
        </UnstyledButton>
      </Flex>

      {/* Right Group: New Creation */}
      <Flex align="center" gap={4}>
        {/* New Creation Button */}
        {isSmallScreen ? (
          <ActionIcon variant="light" size="md" radius="lg" onClick={onNewCreation}>
            <IconPlus size={18} />
          </ActionIcon>
        ) : (
          <Button
            variant="light"
            size="compact-md"
            radius="lg"
            fz="sm"
            leftSection={<IconPlus size={16} />}
            onClick={onNewCreation}
          >
            {t('New Creation')}
          </Button>
        )}
      </Flex>
    </Flex>
  )
}

/* ============================================
   Main Page Component
   ============================================ */

function ImageCreatorPage() {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const { providers } = useProviders()

  const [prompt, setPrompt] = useState('')
  const [referenceImages, setReferenceImages] = useState<
    { storageKey: string; dataUrl: string; sourceRecordId?: string }[]
  >([])
  const [showHistory, setShowHistory] = useState(true)
  const [showMobileHistory, setShowMobileHistory] = useState(false)
  // No provider until one that is set up is picked (the last-used one, or the first image model below).
  const [selectedProvider, setSelectedProvider] = useState<string>('')
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [selectedRatio, setSelectedRatio] = useState<string>('auto')
  const [showModelDrawer, setShowModelDrawer] = useState(false)
  const [showRatioDrawer, setShowRatioDrawer] = useState(false)
  const [comfyuiParams, setComfyuiParams] = useState<ComfyUIGenerationParams>({})

  const isComfyUI = selectedProvider === ModelProviderEnum.ComfyUI

  // Get ratio options based on selected model
  const ratioOptions = getRatioOptionsForModel(selectedModel)

  const activeGenerationId = useActiveGenerationId()
  const queuedGenerationIds = useQueuedGenerationIds()
  const currentRecordId = useCurrentRecordId()
  const { data: currentRecord } = useImageGenerationRecord(currentRecordId)

  const {
    data: historyData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: historyLoading,
  } = useImageGenerationHistory()

  const historyCache = useMemo(() => {
    return historyData?.pages.flatMap((page) => page.items) ?? []
  }, [historyData])

  const isCurrentlyGenerating = activeGenerationId !== null

  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // When navigating from a chat message's "Send to Image Creator" action,
  // search params take priority over last-used model
  const searchParams = Route.useSearch()
  useEffect(() => {
    if (searchParams.prompt) {
      setPrompt(searchParams.prompt)
      setSelectedProvider(ModelProviderEnum.ComfyUI)
      setSelectedModel(COMFYUI_IMAGE_MODEL_IDS[0])
    } else {
      const lastUsed = lastUsedModelStore.getState().picture
      if (lastUsed) {
        setSelectedProvider(lastUsed.provider)
        setSelectedModel(lastUsed.modelId)
      }
    }
  }, [])

  const handleModelSelect = useCallback((provider: string, model: string) => {
    setSelectedProvider(provider)
    setSelectedModel(model)

    // Reset ratio to 'auto' if current ratio is not supported by the new model
    const newRatioOptions = getRatioOptionsForModel(model)
    setSelectedRatio((prev) => (newRatioOptions.includes(prev) ? prev : 'auto'))
  }, [])

  const referenceCountRef = useRef(0)
  useEffect(() => {
    referenceCountRef.current = referenceImages.length
  }, [referenceImages.length])

  const handleImageUpload = useCallback((files: FileList | File[] | null) => {
    if (!files) return
    const list = Array.isArray(files) ? files : Array.from(files)
    if (list.length === 0) return

    const readAsDataUrl = (file: File) =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result || ''))
        reader.onerror = () => reject(reader.error || new Error('read failed'))
        reader.readAsDataURL(file)
      })

    void (async () => {
      for (const file of list) {
        if (!file.type.startsWith('image/') && !/\.(png|jpe?g|webp|gif)$/i.test(file.name)) continue
        if (referenceCountRef.current >= MAX_REFERENCE_IMAGES) {
          log.info('Reference image limit reached, skipping:', file.name)
          break
        }

        let dataUrl = ''
        try {
          dataUrl = await readAsDataUrl(file)
        } catch {
          log.error('Failed to read image file:', file.name)
          continue
        }
        if (!dataUrl) continue

        const storageKey = StorageKeyGenerator.picture('image-creator-ref')
        try {
          await storage.setBlob(storageKey, dataUrl)
          setReferenceImages((prev) => {
            if (prev.length >= MAX_REFERENCE_IMAGES) return prev
            if (prev.some((img) => img.dataUrl === dataUrl)) return prev
            const next = [...prev, { storageKey, dataUrl }]
            referenceCountRef.current = next.length
            return next
          })
        } catch (err) {
          log.error('Failed to store reference image:', file.name, err)
        }
      }
    })()
  }, [])

  const handlePromptPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const images = extractClipboardImages(event.clipboardData)
      if (images.length === 0) return
      // Attach images; keep default text paste for any caption.
      handleImageUpload(images)
    },
    [handleImageUpload]
  )

  const handleRemoveReferenceImage = useCallback((storageKey: string) => {
    setReferenceImages((prev) => prev.filter((img) => img.storageKey !== storageKey))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (!prompt.trim() || !selectedProvider || !selectedModel) return

    try {
      // Collect all unique source record IDs from reference images (DAG support)
      const parentIds = [
        ...new Set(referenceImages.map((img) => img.sourceRecordId).filter((id): id is string => !!id)),
      ]

      await createAndGenerate({
        prompt: prompt.trim(),
        referenceImages: referenceImages.map((img) => img.storageKey),
        model: {
          provider: selectedProvider,
          modelId: selectedModel,
        },
        imageGenerateNum: 1,
        aspectRatio: selectedRatio,
        parentIds: parentIds.length > 0 ? parentIds : undefined,
        comfyuiParams: isComfyUI ? comfyuiParams : undefined,
      })

      setPrompt('')
      setReferenceImages([])
    } catch (error) {
      log.error('Failed to generate image:', error)
    }
  }, [prompt, referenceImages, selectedProvider, selectedModel, selectedRatio, isComfyUI, comfyuiParams])

  const handleQuickPromptSubmit = useCallback(
    async (quickPrompt: string) => {
      if (!selectedProvider || !selectedModel) return
      try {
        await createAndGenerate({
          prompt: quickPrompt,
          referenceImages: [],
          model: {
            provider: selectedProvider,
            modelId: selectedModel,
          },
          imageGenerateNum: 1,
          aspectRatio: 'auto',
        })
      } catch (error) {
        log.error('Failed to generate image:', error)
      }
    },
    [selectedProvider, selectedModel]
  )

  const handleUseAsReference = useCallback(async (storageKey: string, sourceRecordId?: string) => {
    const blob = await storage.getBlob(storageKey)
    if (blob) {
      setReferenceImages((prev) => {
        if (prev.length >= MAX_REFERENCE_IMAGES) return prev
        return [...prev, { storageKey, dataUrl: blobToDataUrl(blob), sourceRecordId }]
      })
    }
  }, [])

  const handleHistoryClick = useCallback(async (record: ImageGeneration) => {
    imageGenerationStore.getState().setCurrentRecordId(record.id)
    setPrompt(record.prompt)

    const refs = await Promise.all(
      record.referenceImages.map(async (key) => {
        const blob = await storage.getBlob(key)
        if (!blob) return null
        return { storageKey: key, dataUrl: blobToDataUrl(blob) }
      })
    )
    setReferenceImages(
      refs.filter((r): r is { storageKey: string; dataUrl: string; sourceRecordId?: string } => r !== null)
    )
  }, [])

  const handleNewCreation = useCallback(() => {
    imageGenerationStore.getState().setCurrentRecordId(null)
    setPrompt('')
    setReferenceImages([])
    textareaRef.current?.focus()
  }, [])

  const handleLoadMoreHistory = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        if (activeGenerationId === id) {
          throw new Error('Active generations must be cancelled before deletion.')
        }

        const record = historyCache.find((item) => item.id === id)
        if (record?.status === 'queued') {
          await removeQueuedGeneration(id)
        } else {
          await deleteRecord(id)
        }
        queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
      } catch (error) {
        log.error('Failed to delete record:', error)
      }
    },
    [activeGenerationId, historyCache]
  )

  const handleCancel = useCallback(async (id: string) => {
    try {
      await cancelGeneration(id)
    } catch (error) {
      log.error('Failed to cancel generation:', error)
    }
  }, [])

  const handleRemoveQueued = useCallback(async (id: string) => {
    try {
      await removeQueuedGeneration(id)
      queryClient.invalidateQueries({ queryKey: [IMAGE_GEN_LIST_QUERY_KEY] })
    } catch (error) {
      log.error('Failed to remove queued generation:', error)
    }
  }, [])

  const handleRetry = useCallback(async (id: string) => {
    try {
      await retryGeneration(id)
    } catch (error) {
      log.error('Failed to retry generation:', error)
    }
  }, [])

  const imageModelGroups = useMemo(() => {
    const flat = listAvailableImageModels(providers)
    const groups: { label: string; providerId: string; models: { modelId: string; displayName: string }[] }[] = []
    for (const item of flat) {
      let group = groups.find((g) => g.providerId === item.providerId)
      if (!group) {
        group = { label: item.providerName, providerId: item.providerId, models: [] }
        groups.push(group)
      }
      if (!group.models.some((m) => m.modelId === item.modelId)) {
        group.models.push({ modelId: item.modelId, displayName: item.displayName })
      }
    }
    return groups
  }, [providers])

  useEffect(() => {
    if (imageModelGroups.length === 0) {
      // Nothing set up makes pictures: keep no model, so nothing is sent to a provider the user did not set up.
      if (selectedProvider || selectedModel) {
        setSelectedProvider('')
        setSelectedModel('')
      }
      return
    }
    const hasSelectedModel = imageModelGroups.some(
      (group) => group.providerId === selectedProvider && group.models.some((model) => model.modelId === selectedModel)
    )
    if (hasSelectedModel) {
      return
    }
    const firstGroup = imageModelGroups[0]
    const firstModel = firstGroup?.models[0]
    if (firstGroup && firstModel) {
      setSelectedProvider(firstGroup.providerId)
      setSelectedModel(firstModel.modelId)
    }
  }, [imageModelGroups, selectedProvider, selectedModel])

  // Workaround: DALL-E-3 was removed in new version, fallback to GPT Image
  useEffect(() => {
    if (selectedModel === 'DALL-E-3') {
      setSelectedModel('')
    }
  }, [selectedModel])

  useEffect(() => {
    if (activeGenerationId === null && queuedGenerationIds.length > 0) {
      resumeQueuedGenerations()
    }
  }, [activeGenerationId, queuedGenerationIds])

  const getModelDisplayName = useCallback(
    (providerId: string, modelId: string) => {
      const provider = providers.find((p) => p.id === providerId)
      if (!provider) {
        return modelId || t('Select model')
      }
      if (!modelId) {
        return provider.name
      }
      const providerModels = provider?.models || provider?.defaultSettings?.models || []
      const model = providerModels.find((m) => m.modelId === modelId)
      const modelName = model?.nickname || IMAGE_MODEL_FALLBACK_NAMES[modelId] || modelId

      const providerName = provider?.name || providerId
      return `${providerName} - ${modelName}`
    },
    [providers, t]
  )

  const modelDisplayName = useMemo(
    () => getModelDisplayName(selectedProvider, selectedModel),
    [getModelDisplayName, selectedProvider, selectedModel]
  )

  const currentRecordModelDisplayName = useMemo(
    () =>
      currentRecord ? getModelDisplayName(currentRecord.model.provider, currentRecord.model.modelId) : modelDisplayName,
    [currentRecord, getModelDisplayName, modelDisplayName]
  )

  const currentRecordStatusLabel = useMemo(() => {
    if (!currentRecord) {
      return undefined
    }

    if (currentRecord.status === 'queued') {
      const queuePosition = queuedGenerationIds.indexOf(currentRecord.id) + 1
      return queuePosition > 0 ? t('Queued #{{count}}', { count: queuePosition }) : t('Queued')
    }

    if (currentRecord.status === 'generating') {
      return currentRecord.queueNumber
        ? t('Generating · Server #{{count}}', { count: currentRecord.queueNumber })
        : t('Generating')
    }

    if (currentRecord.status === 'cancelled') {
      return t('Cancelled')
    }

    if (currentRecord.status === 'error') {
      return t('Error')
    }

    return t('Done')
  }, [currentRecord, queuedGenerationIds, t])

  const headerRight = isSmallScreen ? (
    <ActionIcon
      variant="subtle"
      color="gray"
      size="md"
      radius="lg"
      onClick={() => setShowMobileHistory(true)}
      className="controls"
    >
      <IconHistory size={20} />
    </ActionIcon>
  ) : (
    <UnstyledButton
      onClick={() => setShowHistory(!showHistory)}
      className={`controls flex items-center gap-1.5 px-3 py-1.5 rounded-sm ${showHistory ? 'bg-[var(--chatbox-background-tertiary)]' : 'bg-[var(--chatbox-background-secondary)]'}`}
    >
      <IconHistory size={18} className="text-[var(--chatbox-tint-secondary)]" />
      <Text size="sm" className="text-[var(--chatbox-tint-secondary)]">
        {t('History')}
      </Text>
    </UnstyledButton>
  )

  return (
    <Page title={t('Image Creator')} right={headerRight}>
      <Flex flex={1} h="100%" className="overflow-hidden relative">
        {/* Main Content Area */}
        <Flex direction="column" flex={1} h="100%" className="overflow-hidden relative">
          {/* Results Area */}
          <ScrollArea flex={1} type="auto" offsetScrollbars={!isSmallScreen}>
            <Box maw={900} mx="auto" py="xl" px="md" className="min-h-full">
              {!currentRecord && <EmptyState onPromptSelect={handleQuickPromptSubmit} />}

              {currentRecord && (
                <Stack gap="lg" className="animate-in fade-in duration-300">
                  {currentRecord.status === 'generating' && currentRecord.generatedImages.length === 0 && (
                    <LoadingShimmer />
                  )}

                  {currentRecord.generatedImages.length > 0 && (
                    <Flex justify="center" w="100%">
                      <GeneratedImagesGallery
                        storageKeys={currentRecord.generatedImages}
                        onUseAsReference={(storageKey) => handleUseAsReference(storageKey, currentRecord.id)}
                      />
                    </Flex>
                  )}

                  <PromptDisplay
                    prompt={currentRecord.prompt}
                    modelDisplayName={currentRecordModelDisplayName}
                    referenceImageCount={currentRecord.referenceImages.length}
                    statusLabel={currentRecordStatusLabel}
                  />

                  {(currentRecord.status === 'error' || currentRecord.status === 'cancelled') && (
                    <ImageGenerationErrorTips
                      record={currentRecord}
                      onRetry={() => void handleRetry(currentRecord.id)}
                      isRetrying={
                        queuedGenerationIds.includes(currentRecord.id) || activeGenerationId === currentRecord.id
                      }
                    />
                  )}
                </Stack>
              )}
            </Box>
          </ScrollArea>

          {/* Input Area */}
          <Box py="md" px="sm">
            <Stack gap="xs" maw={800} mx="auto">
              <ReferenceImagesPreview
                images={referenceImages}
                onRemove={handleRemoveReferenceImage}
                onAddClick={() => fileInputRef.current?.click()}
              />

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => handleImageUpload(e.target.files)}
              />

              <Box
                className="rounded-md bg-[var(--chatbox-background-secondary)] px-3 py-2"
                style={{ border: '1px solid var(--chatbox-border-primary)' }}
              >
                <Stack gap="xs">
                  {/* ComfyUI Advanced Controls */}
                  {isComfyUI && <ComfyUIControls params={comfyuiParams} onChange={setComfyuiParams} />}

                  {/* Input Row */}
                  <Flex align="flex-end" gap={4}>
                    <Textarea
                      ref={textareaRef}
                      placeholder={t('Describe the image you want to create...') || ''}
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      minRows={2}
                      maxRows={6}
                      autosize
                      size="sm"
                      className="flex-1"
                      styles={{
                        root: { flex: 1 },
                        wrapper: { flex: 1 },
                        input: {
                          border: 'none',
                          backgroundColor: 'transparent',
                          paddingLeft: 8,
                          paddingRight: 8,
                          '&:focus': { border: 'none', boxShadow: 'none' },
                        },
                      }}
                      onPaste={handlePromptPaste}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleSubmit()
                        }
                      }}
                    />

                    {/* Send Button */}
                    <ActionIcon
                      size={32}
                      variant="filled"
                      color="chatbox-brand"
                      radius="xl"
                      onClick={handleSubmit}
                      disabled={!prompt.trim()}
                      className={`shrink-0 mb-1 ${!prompt.trim() ? 'disabled:!opacity-100 !text-white' : ''}`}
                      style={{
                        ...(!prompt.trim() ? { backgroundColor: 'rgba(222, 226, 230, 1)' } : {}),
                      }}
                    >
                      <IconArrowUp size={16} />
                    </ActionIcon>
                  </Flex>

                  {isCurrentlyGenerating && (
                    <Text size="xs" c="dimmed">
                      {queuedGenerationIds.length > 0
                        ? t('1 generation running, {{count}} queued', { count: queuedGenerationIds.length })
                        : t('1 generation running')}
                    </Text>
                  )}

                  {/* Toolbar Row */}
                  <InputToolbar
                    isSmallScreen={isSmallScreen}
                    modelDisplayName={modelDisplayName}
                    selectedRatio={selectedRatio}
                    ratioOptions={ratioOptions}
                    onModelDrawerOpen={() => setShowModelDrawer(true)}
                    onRatioDrawerOpen={() => setShowRatioDrawer(true)}
                    onRatioSelect={setSelectedRatio}
                    onModelSelect={handleModelSelect}
                    onAddReference={() => fileInputRef.current?.click()}
                    onNewCreation={handleNewCreation}
                  />
                </Stack>
              </Box>

              <Text className="disclaimer-safe-area" size="xs" c="dimmed" ta="center">
                {t('AI-generated images may not be accurate. Review output carefully.')}
              </Text>
            </Stack>
          </Box>
        </Flex>

        {/* Desktop History Panel */}
        {!isSmallScreen && (
          <HistoryPanel
            show={showHistory}
            width={HISTORY_PANEL_WIDTH}
            historyCache={historyCache}
            historyLoading={historyLoading}
            currentRecordId={currentRecord?.id ?? null}
            activeGenerationId={activeGenerationId}
            queuedGenerationIds={queuedGenerationIds}
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            onItemClick={handleHistoryClick}
            onLoadMore={handleLoadMoreHistory}
            onNewCreation={handleNewCreation}
            onClose={() => setShowHistory(false)}
            onRetry={handleRetry}
            onCancel={handleCancel}
            onRemoveQueued={handleRemoveQueued}
            onDelete={handleDelete}
          />
        )}

        {/* Mobile Drawers */}
        {isSmallScreen && (
          <>
            <MobileHistoryDrawer
              open={showMobileHistory}
              onOpenChange={setShowMobileHistory}
              historyCache={historyCache}
              historyLoading={historyLoading}
              currentRecordId={currentRecord?.id ?? null}
              activeGenerationId={activeGenerationId}
              queuedGenerationIds={queuedGenerationIds}
              hasNextPage={hasNextPage}
              isFetchingNextPage={isFetchingNextPage}
              onItemClick={handleHistoryClick}
              onLoadMore={handleLoadMoreHistory}
              onNewCreation={handleNewCreation}
              onRetry={handleRetry}
              onCancel={handleCancel}
              onRemoveQueued={handleRemoveQueued}
              onDelete={handleDelete}
            />

            <MobileModelDrawer
              open={showModelDrawer}
              onOpenChange={setShowModelDrawer}
              modelGroups={imageModelGroups}
              selectedProvider={selectedProvider}
              selectedModel={selectedModel}
              onSelect={handleModelSelect}
            />

            <MobileRatioDrawer
              open={showRatioDrawer}
              onOpenChange={setShowRatioDrawer}
              options={ratioOptions}
              selectedRatio={selectedRatio}
              onSelect={setSelectedRatio}
            />
          </>
        )}
      </Flex>
    </Page>
  )
}

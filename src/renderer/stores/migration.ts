import * as Sentry from '@sentry/react'
import {
  type ImageGeneration,
  type ModelProvider,
  ModelProviderEnum,
  ModelProviderType,
  type Session,
  type SessionMeta,
  type Settings,
} from '@shared/types'
import dayjs from 'dayjs'
import { getDefaultStore } from 'jotai'
import { difference, intersection, keyBy, uniq, uniqBy } from 'lodash'
import oldStore from 'store'
import { v4 as uuidv4 } from 'uuid'
import { defaultSessionsForCN, defaultSessionsForEN, retiredChineseDemoSessionIds } from '@/packages/initial_data'
import platform from '@/platform'
import type { Storage } from '@/platform/interfaces'
import { getOldVersionStorages } from '@/platform/storages'
import WebPlatform from '@/platform/web_platform'
import { initData } from '@/setup/init_data'
import storage, { StorageKey } from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as defaults from '../../shared/defaults'
import { getLogger } from '../lib/utils'
import { migrationProcessAtom } from './atoms/utilAtoms'
import { getSessionMeta } from './sessionHelpers'

const log = getLogger('migration')

export async function migrate() {
  await migrateStorage()
  await migrateOnData(
    {
      getData: storage.getItem.bind(storage),
      setData: storage.setItemNow.bind(storage),
      setAll: storage.setAll.bind(storage),
      setBlob: storage.setBlob.bind(storage),
      removeData: storage.removeItem.bind(storage),
    },
    true
  )
}

type MigrateStore = {
  getData: <T>(key: StorageKey | string, defaultValue: T) => Promise<T>
  setData: <T>(key: StorageKey | string, value: T) => Promise<void>
  setAll: (data: { [key: string]: unknown }) => Promise<void>
  setBlob?: (key: string, value: string) => Promise<void>
  removeData?: (key: StorageKey | string) => Promise<void>
}

export const CurrentVersion = 18

async function doMigrateStorage(oldStorage: Storage) {
  // (legacy comment removed)
  log.info(
    `migrateStorage: old version storage found, migrating data from old storage(${oldStorage.getStorageType()}) to ${storage.getStorageType()}`
  )
  if (platform.type === 'mobile') {
    // for mobile copy all keys
    const keys = await oldStorage.getAllStoreKeys()
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]
      try {
        const val = await oldStorage.getStoreValue(key)
        await storage.setItemNow(key, val)
        log.info(`migrateStorage: ${index + 1} / ${keys.length} migrated`)
      } catch {
        log.info(`migrateStorage: failed to migrate ${key}`)
      }
    }
  } else if (platform.type === 'desktop') {
    // Desktop hybrid storage:
    // - settings / configs / configVersion: always IPC file
    // - sessions + chat-sessions-list: shared IPC file (multi-window quick chat)
    // - other keys: IndexedDB
    // Only copy keys that leave file storage; do not delete session/settings keys from file.
    const staysInFile = (k: string) =>
      k === 'settings' ||
      k === 'configs' ||
      k === 'configVersion' ||
      k === 'chat-sessions-list' ||
      k.startsWith('session:')

    const kvs = await oldStorage.getAllStoreValues()
    const keys = Object.keys(kvs).filter((k) => !staysInFile(k))
    for (let index = 0; index < keys.length; index++) {
      const key = keys[index]
      try {
        const val = kvs[key]
        await storage.setItemNow(key, val)
        await oldStorage.delStoreValue(key)
        log.info(`migrateStorage: ${index + 1} / ${keys.length} migrated`)
      } catch {
        log.info(`migrateStorage: failed to migrate ${key}`)
      }
    }
  } else {
    // no migration for web platform yet
  }
  const migrated = await oldStorage.getStoreValue('migrated')

  await oldStorage.setStoreValue(
    'migrated',
    `${migrated ? `${migrated}\n` : ''}migrated from ${oldStorage.getStorageType()} to ${storage.getStorageType()} on ${dayjs().format('YYYY-MM-DD')}`
  )
}

async function findNewestStorage(oldStorages: Storage[]): Promise<[number, Storage | null]> {
  let configVersion = 0
  let newestStorage: Storage | null = null
  for (const oldStorage of oldStorages) {
    const version = await oldStorage.getStoreValue(StorageKey.ConfigVersion)
    if (version && version > configVersion) {
      configVersion = version
      newestStorage = oldStorage
    }
  }
  return [configVersion, newestStorage]
}
export const _migrateStorageForTest = migrateStorage

async function migrateStorage() {
  const configVersion = await storage.getItem<number>(StorageKey.ConfigVersion, 0)

  log.info(`migrateStorage: current storage config version: ${configVersion}`)

  if (configVersion >= CurrentVersion) {
    return
  }

  /**
   * (legacy comment removed)
   * (legacy comment)
   * (legacy comment)
   * (legacy comment)
   * (legacy comment)
   */

  let needMigration = false

  const latestDesktopMigratedVersion = 12 // Latest desktop migration version 11→12

  // configVersionconfig file storage，storage
  if (platform.type === 'desktop' && configVersion > 0 && configVersion < latestDesktopMigratedVersion) {
    log.info(
      `migrateStorage: desktop platform needs migration, config version ${configVersion} < latest migrated version ${latestDesktopMigratedVersion}`
    )
    needMigration = true
  }

  // Pass platform.type so we never re-detect inside storages (avoids platform↔storages cycle)
  const [oldConfigVersion, oldStorage] = await findNewestStorage(getOldVersionStorages(platform.type))

  if (!needMigration) {
    log.info(
      `migrateStorage check: platform ${platform.type} (formFactor: ${platform.formFactor}) old config version: ${oldConfigVersion}, old storage: ${oldStorage?.getStorageType()}`
    )

    if (
      platform.type !== 'desktop' &&
      oldConfigVersion > configVersion &&
      oldStorage &&
      oldStorage.getStorageType() !== storage.getStorageType()
    ) {
      needMigration = true
    }
  }

  if (needMigration && oldStorage) {
    await doMigrateStorage(oldStorage)
  }

  if (configVersion === 0 && needMigration === false) {
    log.info(`migrateStorage: no old storage found, and config version is 0, initializing data`)
    // ，ConfigVersionCurrentVersion，
    await storage.setItemNow(StorageKey.ConfigVersion, CurrentVersion)
    // (legacy comment removed)
    await initData()
  }
}

export async function migrateOnData(dataStore: MigrateStore, canRelaunch = true) {
  let needRelaunch = false
  let configVersion = await dataStore.getData(StorageKey.ConfigVersion, 0)

  if (configVersion >= CurrentVersion) {
    return
  }

  const scope = Sentry.getCurrentScope()
  scope.setTag('configVersion', configVersion)
  log.info(`migrateOnData: ${configVersion}, canRelaunch: ${canRelaunch}`)

  const migrateFunctions = [
    null,
    null,
    migrate_2_to_3,
    null,
    null,
    null,
    null,
    migrate_7_to_8,
    null,
    migrate_9_to_10,
    migrate_10_to_11,
    migrate_11_to_12,
    migrate_12_to_13,
    migrate_13_to_14,
    migrate_14_to_15,
    migrate_15_to_16,
    migrate_16_to_17,
    migrate_17_to_18,
  ]

  for (; configVersion < CurrentVersion; configVersion++) {
    const _needRelaunch = await migrateFunctions[configVersion]?.(dataStore)
    needRelaunch ||= !!_needRelaunch
    await dataStore.setData(StorageKey.ConfigVersion, configVersion + 1)
    log.info(`migrate_${configVersion}_to_${configVersion + 1}, needRelaunch: ${needRelaunch}`)
  }

  // (legacy comment removed)
  if (needRelaunch && canRelaunch) {
    log.info(`migrate: relaunch`)
    await platform.relaunch()
  }
}

async function migrate_0_to_1(dataStore: MigrateStore) {
  const settings = await dataStore.getData(StorageKey.Settings, defaults.settings())
  // (legacy comment)
  if (settings.showTokenCount) {
    await dataStore.setData(StorageKey.Settings, {
      ...settings,
      showTokenUsed: true,
    })
  }
}

async function migrate_1_to_2(_dataStore: MigrateStore) {
  // Deprecated: no longer inject demo sessions.
}

async function migrate_2_to_3(dataStore: MigrateStore) {
  // (legacy comment)
  if (!dataStore.setBlob) {
    return
  }
  if (platform.type !== 'desktop') {
    return
  }
  const ws = new WebPlatform()
  const blobKeys = await ws.listStoreBlobKeys()
  for (const key of blobKeys) {
    const value = await ws.getStoreBlob(key)
    if (!value) {
      continue
    }
    await dataStore.setBlob(key, value)
    await ws.delStoreBlob(key)
  }
}

async function migrate_3_to_4(_dataStore: MigrateStore) {
  // Deprecated: no longer inject demo sessions.
}

// storage migration
async function migrate_4_to_5(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'web') {
    return false
  }
  // ， store localforage
  // (legacy comment)
  const keys: string[] = []
  oldStore.each((value, key) => {
    keys.push(key)
  })
  if (keys.length === 0) {
    return false
  }
  for (const key of keys) {
    await dataStore.setData(key, oldStore.get(key))
  }
  return true
}

async function migrate_5_to_6(_dataStore: MigrateStore) {
  // Deprecated: no longer inject demo sessions.
}

// mobile ， store sqlite
// (legacy comment removed)
// (legacy comment removed)
async function migrate_6_to_7(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'mobile') {
    return false
  }
  // mobile， store sqllite
  // (legacy comment removed)
  const keys: string[] = []
  oldStore.each((value, key) => {
    keys.push(key)
  })
  if (keys.length === 0) {
    return false
  }
  for (const key of keys) {
    await dataStore.setData(key, oldStore.get(key))
  }
  return true
}

// sessions key session key， session
async function migrate_7_to_8(dataStore: MigrateStore): Promise<boolean> {
  const sessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  log.info(`migrate_7_to_8, sessions: ${sessions.length}`)
  if (sessions.length === 0) {
    return false
  }

  const sessionList = sessions.map((session) => getSessionMeta(session))
  await dataStore.setData(StorageKey.ChatSessionsList, sessionList)
  log.info(`migrate_7_to_8, sessionList: ${sessionList.length}`)

  // (legacy comment)
  const sessionMap = keyBy(sessions, (session) => StorageKeyGenerator.session(session.id))
  await dataStore.setAll(sessionMap)
  log.info(`migrate_7_to_8, done`)
  return true
}

// 7 ， 7_8 ， chat-sessions chat-sessions-list session，
async function migrate_8_to_9(dataStore: MigrateStore): Promise<boolean> {
  if (platform.type !== 'mobile') {
    return false
  }

  const oldSessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  log.info(`migrate_8_to_9, old sessions: ${oldSessions.length}`)
  if (oldSessions.length === 0) {
    return false
  }

  const sessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  const existedSessionIds = sessionList.map((session) => session.id)

  // session， chat-sessions chat-sessions-list session id ， 7-8 migration，，
  const intersectSessionIds = intersection(
    existedSessionIds,
    oldSessions.map((session) => session.id)
  )

  const defaultSessionIds = uniq([
    ...defaultSessionsForEN.map((session) => session.id),
    ...defaultSessionsForCN.map((session) => session.id),
    ...retiredChineseDemoSessionIds,
  ])

  // intersectSessionIds ， 7-8 migration，
  if (difference(intersectSessionIds, defaultSessionIds).length !== 0) {
    return false
  }

  // chat-sessions chat-sessions-list session
  const missedSessions = oldSessions.filter((session) => !existedSessionIds.includes(session.id))
  const missedSessionList = missedSessions.map((session) => getSessionMeta(session))
  log.info(`migrate_8_to_9, missedSessions: ${missedSessions.length}`)

  // chat-sessions-list
  await dataStore.setData(StorageKey.ChatSessionsList, [...sessionList, ...missedSessionList])
  const missedSessionMap = keyBy(missedSessions, (session) => StorageKeyGenerator.session(session.id))
  await dataStore.setAll(missedSessionMap)
  log.info(`migrate_8_to_9 done`)

  return true
}

function setInitProcess(process: string) {
  const store = getDefaultStore()
  store.set(migrationProcessAtom, process)
}

// provider settings，session settings
async function migrate_9_to_10(dataStore: MigrateStore): Promise<boolean> {
  const oldSettings = (await dataStore.getData(StorageKey.Settings, null)) as any
  if (oldSettings) {
    const {
      aiProvider,
      // openai
      openaiKey,
      apiHost,
      model,
      openaiCustomModel, // OpenAI custom model id
      openaiCustomModelOptions,
      openaiUseProxy, // deprecated

      dalleStyle,
      imageGenerateNum,

      // azure
      azureEndpoint,
      azureDeploymentName,
      azureDeploymentNameOptions,
      azureDalleDeploymentName, // DALL-E-3 deployment name
      azureApikey,
      azureApiVersion,

      // chatglm
      chatglm6bUrl, // deprecated
      chatglmApiKey,
      chatglmModel,

      // chatbox-ai
      chatboxAIModel,

      // claude
      claudeApiKey,
      claudeApiHost,
      claudeModel,

      // google gemini
      geminiAPIKey,
      geminiAPIHost,
      geminiModel,

      // ollama
      ollamaHost,
      ollamaModel,

      // groq
      groqAPIKey,
      groqModel,

      // deepseek
      deepseekAPIKey,
      deepseekModel,

      // siliconflow
      siliconCloudKey,
      siliconCloudModel,

      // LMStudio
      lmStudioHost,
      lmStudioModel,

      // perplexity
      perplexityApiKey,
      perplexityModel,

      // xai
      xAIKey,
      xAIModel,

      // custom provider
      selectedCustomProviderId, // Selected custom provider id when aiProvider is custom
      customProviders: oldCustomProviders,

      temperature, // 0-2
      topP, // 0-1
      openaiMaxContextMessageCount, // Context message limit; over 20 means unlimited
      maxContextMessageCount,
    } = oldSettings

    // provider
    const providers: Settings['providers'] = {}
    const customProviders: Settings['customProviders'] = []

    try {
      if (openaiKey || apiHost) {
        providers[ModelProviderEnum.OpenAI] = {
          apiHost,
          apiKey: openaiKey,
          // openaiCustomModelOptionsopenaiCustomModel
          models:
            openaiCustomModel || openaiCustomModelOptions
              ? uniqBy(
                  [
                    ...(defaults.SystemProviders().find((p) => p.id === ModelProviderEnum.OpenAI)?.defaultSettings
                      ?.models || []),
                    ...(openaiCustomModel ? [{ modelId: openaiCustomModel }] : []),
                    ...(openaiCustomModelOptions || []).map((o: string) => ({
                      modelId: o,
                    })),
                  ],
                  'modelId'
                )
              : undefined,
        }
      }
      log.info('migrate openai settings done')
    } catch (e) {
      log.info('migrate openai settings failed.')
    }

    if (claudeApiKey || claudeApiHost) {
      providers[ModelProviderEnum.Claude] = {
        apiKey: claudeApiKey,
        apiHost: claudeApiHost,
      }
      log.info('migrate claude settings done')
    }
    if (geminiAPIKey || geminiAPIHost) {
      providers[ModelProviderEnum.Gemini] = {
        apiKey: geminiAPIKey,
        apiHost: geminiAPIHost,
      }
      log.info('migrate gemini settings done')
    }
    if (deepseekAPIKey) {
      providers[ModelProviderEnum.DeepSeek] = {
        apiKey: deepseekAPIKey,
      }
      log.info('migrate deepseek settings done')
    }
    if (siliconCloudKey) {
      providers[ModelProviderEnum.SiliconFlow] = {
        apiKey: siliconCloudKey,
      }
      log.info('migrate siliconflow settings done')
    }
    if (azureEndpoint || azureDeploymentNameOptions || azureDalleDeploymentName || azureApikey || azureApiVersion) {
      providers[ModelProviderEnum.Azure] = {
        apiKey: azureApikey,
        endpoint: azureEndpoint,
        dalleDeploymentName: azureDalleDeploymentName,
        apiVersion: azureApiVersion,
        models: azureDeploymentNameOptions?.map((op: string) => ({
          modelId: op,
        })),
      }
      log.info('migrate azure settings done')
    }
    if (xAIKey) {
      providers[ModelProviderEnum.XAI] = {
        apiKey: xAIKey,
      }
      log.info('migrate xai settings done')
    }
    if (ollamaHost) {
      providers[ModelProviderEnum.Ollama] = {
        apiHost: ollamaHost,
      }
      log.info('migrate ollama settings done')
    }
    if (lmStudioHost) {
      providers[ModelProviderEnum.LMStudio] = {
        apiHost: lmStudioHost,
      }
      log.info('migrate lmstudio settings done')
    }
    if (perplexityApiKey) {
      providers[ModelProviderEnum.Perplexity] = {
        apiKey: perplexityApiKey,
      }
      log.info('migrate perplexity settings done')
    }
    if (groqAPIKey) {
      providers[ModelProviderEnum.Groq] = {
        apiKey: groqAPIKey,
      }
      log.info('migrate groq settings done')
    }
    if (chatglmApiKey) {
      providers[ModelProviderEnum.ChatGLM6B] = {
        apiKey: chatglmApiKey,
      }
      log.info('migrate chatglm settings done')
    }

    try {
      if (oldCustomProviders) {
        oldCustomProviders.forEach((cp: any) => {
          const pid = 'custom-provider-' + uuidv4()
          customProviders.push({
            id: pid,
            name: cp.name,
            isCustom: true,
            type: ModelProviderType.OpenAI,
          })
          providers[pid] = {
            apiKey: cp.key,
            apiHost: cp.host,
            apiPath: cp.path,
            useProxy: cp.useProxy,
            models: uniq([...(cp.modelOptions || []), cp.model || ''])
              .filter((op) => !!op)
              .map((op: any) => ({
                modelId: op,
              })),
          }
          log.info(`migrate custom provider [${cp.name}] settings done`)
        })
      }
    } catch (e) {
      log.info('migrate custom provider settings failed.')
    }

    try {
      await dataStore.setData(StorageKey.Settings, {
        ...oldSettings,
        providers,
        customProviders,
      } as Settings)
      log.info('migrate settings done')
    } catch (e) {
      log.info('save new settings to store failed.')
    }
  }

  // session settings
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_9_to_10, chatSessionList: ${chatSessionList.length}`)

  const sessionMap: { [key: string]: Session } = {}
  for (let i = 0; i < chatSessionList.length; i++) {
    const sessionMeta = chatSessionList[i]
    try {
      const session: Session = await dataStore.getData(StorageKeyGenerator.session(sessionMeta.id) as any, {} as any)

      if (session.id) {
        const oldSessionSettings = (session.settings || {}) as any
        const sessionProvider: ModelProvider = oldSessionSettings.aiProvider ?? oldSettings.aiProvider
        const modelKey = {
          [ModelProviderEnum.ChatboxAI]: 'chatboxAIModel',
          [ModelProviderEnum.OpenAI]: 'model',
          [ModelProviderEnum.Claude]: 'claudeModel',
          [ModelProviderEnum.Gemini]: 'geminiModel',
          [ModelProviderEnum.Ollama]: 'ollamaModel',
          [ModelProviderEnum.LMStudio]: 'lmStudioModel',
          [ModelProviderEnum.DeepSeek]: 'deepseekModel',
          [ModelProviderEnum.SiliconFlow]: 'siliconCloudModel',
          [ModelProviderEnum.Azure]: 'azureDeploymentName',
          [ModelProviderEnum.XAI]: 'xAIModel',
          [ModelProviderEnum.Perplexity]: 'perplexityModel',
          [ModelProviderEnum.Groq]: 'groqModel',
          [ModelProviderEnum.ChatGLM6B]: 'chatglmModel',
          [ModelProviderEnum.Custom]: 'model',
        }[sessionProvider]
        const modelId: string = oldSessionSettings[modelKey!] ?? oldSettings[modelKey!]
        session.settings =
          session.type === 'chat'
            ? {
                provider: sessionProvider,
                modelId,
                maxContextMessageCount: oldSessionSettings.maxContextMessageCount ?? oldSettings.maxContextMessageCount,
                temperature: oldSessionSettings.temperature ?? oldSettings.temperature,
                topP: oldSessionSettings.topP ?? oldSettings.topP,
              }
            : {
                provider: [ModelProviderEnum.ChatboxAI, ModelProviderEnum.OpenAI, ModelProviderEnum.Azure].includes(
                  oldSettings.aiProvider
                )
                  ? oldSettings.aiProvider
                  : ModelProviderEnum.ChatboxAI,
                modelId: 'DALL-E-3',
                imageGenerateNum: oldSessionSettings.imageGenerateNum ?? 3,
                dalleStyle: oldSessionSettings.dalleStyle ?? 'vivid',
              }

        sessionMap[StorageKeyGenerator.session(session.id)] = session
      }
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings done`)
    } catch (e) {
      log.info(`migrate session [${i + 1}/${chatSessionList.length}] settings failed, ${sessionMeta.name}`)
    }
  }

  try {
    await dataStore.setAll(sessionMap)
    log.info('migrate sessions settings done')
  } catch (e) {
    log.info('save sessions settings to store failed.')
  }

  log.info(`migrate_9_to_10, done`)
  return true
}

async function migrate_10_to_11(dataStore: MigrateStore) {
  if (platform.type === 'mobile') {
    // localstorage
    log.info('migrate_10_to_11, remove settings')
    oldStore.remove(StorageKey.Settings)
  }

  // (legacy comment removed)
  const settings = await dataStore.getData<Settings | null>(StorageKey.Settings, null)
  if (settings) {
    if (settings.fontSize === 16) {
      settings.fontSize = 14
    }
    await dataStore.setData(StorageKey.Settings, settings)
  }
  log.info('migrate_10_to_11, done')
  return false
}

// (legacy comment)
async function migrate_11_to_12(dataStore: MigrateStore) {
  return true
}

// (legacy comment)
async function migrate_12_to_13(dataStore: MigrateStore) {
  return true
}

async function migrate_13_to_14(dataStore: MigrateStore) {
  const chatSessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  log.info(`migrate_13_to_14, total sessions: ${chatSessionList.length}`)

  const pictureSessions = chatSessionList.filter((s) => s.type === 'picture')
  log.info(`migrate_13_to_14, picture sessions: ${pictureSessions.length}`)

  if (pictureSessions.length === 0) {
    return false
  }

  const imageGenerationStorage = platform.getImageGenerationStorage()
  await imageGenerationStorage.initialize()

  let migratedCount = 0

  for (const sessionMeta of pictureSessions) {
    try {
      const sessionKey = StorageKeyGenerator.session(sessionMeta.id)
      const session = (await dataStore.getData(sessionKey, null)) as Session | null

      if (!session || !session.messages) {
        continue
      }

      let parentId: string | undefined
      for (let i = 0; i < session.messages.length; i++) {
        const msg = session.messages[i]
        if (msg.role !== 'user') continue

        const assistantMsg = session.messages.slice(i + 1).find((m) => m.role === 'assistant')
        if (!assistantMsg) continue

        const prompt = msg.contentParts?.find((p) => p.type === 'text')?.text || ''
        if (!prompt) continue

        const referenceImages = (msg.contentParts || [])
          .filter(
            (p): p is { type: 'image'; storageKey: string } =>
              p.type === 'image' && !!p.storageKey && p.storageKey.length > 0
          )
          .map((p) => p.storageKey)

        const generatedImages = (assistantMsg.contentParts || [])
          .filter(
            (p): p is { type: 'image'; storageKey: string } =>
              p.type === 'image' && !!p.storageKey && p.storageKey.length > 0
          )
          .map((p) => p.storageKey)

        if (generatedImages.length === 0) continue

        const recordId = uuidv4()
        const record: ImageGeneration = {
          id: recordId,
          prompt,
          referenceImages,
          generatedImages,
          createdAt: assistantMsg.timestamp || Date.now(),
          model: {
            provider: session.settings?.provider || ModelProviderEnum.ChatboxAI,
            modelId: session.settings?.modelId || 'DALL-E-3',
          },
          dalleStyle: session.settings?.dalleStyle,
          imageGenerateNum: session.settings?.imageGenerateNum,
          status: 'done',
          parentIds: parentId ? [parentId] : undefined,
        }

        await imageGenerationStorage.create(record)
        migratedCount++
        parentId = recordId
      }
    } catch (e) {
      log.info(`migrate_13_to_14, failed to migrate session: ${sessionMeta.id}`, e)
    }
  }

  log.info(`migrate_13_to_14, migrated ${migratedCount} image generation records`)
  return false
}

async function migrate_14_to_15(dataStore: MigrateStore) {
  const demoSessionIds = new Set(
    uniq([
      ...defaultSessionsForEN.map((session) => session.id),
      ...defaultSessionsForCN.map((session) => session.id),
      ...retiredChineseDemoSessionIds,
    ])
  )

  if (demoSessionIds.size === 0) {
    return false
  }

  const sessionList = await dataStore.getData<SessionMeta[]>(StorageKey.ChatSessionsList, [])
  const filteredSessionList = sessionList.filter((session) => !demoSessionIds.has(session.id))
  const removedSessionCount = sessionList.length - filteredSessionList.length

  if (removedSessionCount > 0) {
    await dataStore.setData(StorageKey.ChatSessionsList, filteredSessionList)

    if (dataStore.removeData) {
      for (const sessionMeta of sessionList) {
        if (demoSessionIds.has(sessionMeta.id)) {
          await dataStore.removeData(StorageKeyGenerator.session(sessionMeta.id))
        }
      }
    }
  }

  const legacySessions = await dataStore.getData<Session[]>(StorageKey.ChatSessions, [])
  const filteredLegacySessions = legacySessions.filter((session) => !demoSessionIds.has(session.id))
  if (filteredLegacySessions.length !== legacySessions.length) {
    await dataStore.setData(StorageKey.ChatSessions, filteredLegacySessions)
  }

  if (removedSessionCount > 0) {
    log.info(`migrate_14_to_15, removed ${removedSessionCount} demo sessions`)
  }

  return false
}

/** Migrate userPersonalInfo → global memory bank; disable old personal-info inject. */
async function migrate_15_to_16(dataStore: MigrateStore) {
  const settings = await dataStore.getData(StorageKey.Settings, defaults.settings())
  const personalInfo = settings.userPersonalInfo

  const existingBank = await dataStore.getData(StorageKey.MemoryBankGlobal, null)
  const { migratePersonalInfoToBank } = await import('@/packages/memory/migrate-personal-info')
  const { bank, migratedCount } = migratePersonalInfoToBank(personalInfo, existingBank as never)

  if (migratedCount > 0 || !existingBank) {
    await dataStore.setData(StorageKey.MemoryBankGlobal, bank)
  }

  // Default memory settings
  const existingMemorySettings = await dataStore.getData(StorageKey.MemorySettings, null)
  if (!existingMemorySettings) {
    const { defaultMemorySettings } = await import('@shared/types/memory')
    await dataStore.setData(StorageKey.MemorySettings, defaultMemorySettings())
  }

  // Stop dual inject: personal info injection off after migrate
  if (personalInfo?.enableInjection) {
    await dataStore.setData(StorageKey.Settings, {
      ...settings,
      userPersonalInfo: {
        ...personalInfo,
        enableInjection: false,
      },
    })
  }

  log.info(`migrate_15_to_16, migrated ${migratedCount} personal info entries to memory bank`)
  return false
}

/** Dual-write portable Projects from Folders. Native bindings are never migrated. */
async function migrate_16_to_17(dataStore: MigrateStore) {
  const { runProjectMetadataMigration } = await import('@/projects/project-migration')
  await runProjectMetadataMigration({
    getData: dataStore.getData,
    setData: dataStore.setData,
  })
  log.info('migrate_16_to_17, portable Project metadata dual-write complete')
  return false
}

/** Write `kind` on stored projects (scopes); re-id a project that collides with the reserved Everywhere id. */
async function migrate_17_to_18(dataStore: MigrateStore) {
  const { runScopeMigration } = await import('@/projects/scope-migration')
  await runScopeMigration({
    getData: dataStore.getData,
    setData: dataStore.setData,
  })
  log.info('migrate_17_to_18, scopes written')
  return false
}

import { z } from 'zod'
import { ModelProviderEnum, ModelProviderType } from './provider'

// Re-export for backward compatibility
export { ModelProviderType } from './provider'

// ===== Document Parser Types =====

/**
 * Document parser service type
 * - none: No parsing service, only supports basic text files (mobile/web default)
 * - local: Local parsing using built-in libraries (desktop default)
 * - chatbox-ai: Legacy value kept for backward compatibility (mapped to local in this build)
 * - mineru: Third-party MinerU parsing service (desktop only)
 */
export type DocumentParserType = 'none' | 'local' | 'chatbox-ai' | 'mineru'

export const DocumentParserConfigSchema = z.object({
  type: z.enum(['none', 'local', 'chatbox-ai', 'mineru']),
  mineru: z
    .object({
      apiToken: z.string(),
    })
    .optional(),
})

export type DocumentParserConfig = z.infer<typeof DocumentParserConfigSchema>

export const DEFAULT_DOCUMENT_PARSER_CONFIG: DocumentParserConfig = {
  type: 'local',
}

export const ProviderModelInfoSchema = z.object({
  modelId: z.string(),
  type: z.enum(['chat', 'embedding', 'rerank']).optional().catch(undefined),
  apiStyle: z.enum(['google', 'openai', 'anthropic']).optional().catch(undefined),
  nickname: z.string().optional().catch(undefined),
  labels: z.array(z.string()).optional().catch([]),
  capabilities: z
    .array(
      z.enum([
        'vision',
        'reasoning',
        'tool_use',
        'web_search',
        'image_generation',
        'image_edit',
      ])
    )
    .optional()
    .catch([]),
  contextWindow: z.number().optional().catch(undefined),
  maxOutput: z.number().optional().catch(undefined),
})

const ComfyUILoraSettingsSchema = z.object({
  name: z.string(),
  strengthModel: z.number().optional().catch(undefined),
  strengthClip: z.number().optional().catch(undefined),
})

export const ProviderSettingsSchema = z.object({
  apiKey: z.string().optional().catch(undefined),
  apiHost: z.string().optional().catch(undefined),
  apiPath: z.string().optional().catch(undefined),
  cloudflareClientId: z.string().optional().catch(undefined),
  cloudflareClientSecret: z.string().optional().catch(undefined),
  imagePromptCharacterPrepend: z.string().optional().catch(undefined),
  imagePromptPositiveTagsPrepend: z.string().optional().catch(undefined),
  models: z.array(ProviderModelInfoSchema).optional().catch(undefined),
  excludedModels: z.array(z.string()).optional().catch(undefined),
  useProxy: z.boolean().optional().catch(undefined),

  // Plan presets (e.g. QwenCloud Token Plan) — optional, backward compatible
  planId: z.string().optional().catch(undefined),
  region: z.string().optional().catch(undefined),

  // Dual auth (xAI SuperGrok / OpenAI ChatGPT Codex OAuth vs developer API key)
  authMode: z.enum(['api_key', 'oauth']).optional().catch(undefined),
  oauth: z
    .object({
      accessToken: z.string().optional().catch(undefined),
      refreshToken: z.string().optional().catch(undefined),
      expiresAt: z.number().optional().catch(undefined),
      tokenType: z.string().optional().catch(undefined),
      scope: z.string().optional().catch(undefined),
      obtainedAt: z.number().optional().catch(undefined),
      /** ChatGPT account id (Codex / WHAM requires ChatGPT-Account-Id header) */
      accountId: z.string().optional().catch(undefined),
      /** Plan type from JWT claims when available (plus, pro, team, …) */
      planType: z.string().optional().catch(undefined),
      idToken: z.string().optional().catch(undefined),
      /** Google Cloud / Cloud Code Assist project id (Antigravity / Gemini OAuth) */
      projectId: z.string().optional().catch(undefined),
      /** Signed-in Google account email (display only) */
      email: z.string().optional().catch(undefined),
      /** User accepted experimental Antigravity/Google OAuth risk notice */
      riskAcceptedAt: z.number().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),

  // azure
  endpoint: z.string().optional().catch(undefined),
  deploymentName: z.string().optional().catch(undefined),
  dalleDeploymentName: z.string().optional().catch(undefined),
  apiVersion: z.string().optional().catch(undefined),

  // comfyui
  comfyuiCheckpoint: z.string().optional().catch(undefined),
  comfyuiLoras: z.array(ComfyUILoraSettingsSchema).optional().catch(undefined),
  comfyuiLora: z.string().optional().catch(undefined),
  comfyuiLoraStrength: z.number().optional().catch(undefined),
  comfyuiNegativePrompt: z.string().optional().catch(undefined),
  comfyuiDefaultSteps: z.number().optional().catch(undefined),
  comfyuiDefaultCfg: z.number().optional().catch(undefined),
  comfyuiDefaultSampler: z.string().optional().catch(undefined),
  comfyuiDefaultScheduler: z.string().optional().catch(undefined),
  agentImageFlowEnabled: z.boolean().optional().catch(undefined),
  agentImageResearchDomains: z.array(z.string()).optional().catch(undefined),
  agentImageNormalizationPrompt: z.string().optional().catch(undefined),
})

const BuiltinProviderBaseInfoSchema = z.object({
  id: z.nativeEnum(ModelProviderEnum),
  name: z.string(),
  type: z.nativeEnum(ModelProviderType).catch(ModelProviderType.OpenAI),
  isCustom: z.literal(false).optional().catch(undefined),
  description: z.string().optional().catch(undefined),
  urls: z
    .object({
      website: z.string().nullish(),
      apiKey: z.string().nullish(),
      docs: z.string().nullish(),
      models: z.string().nullish(),
    })
    .optional()
    .catch(undefined),
  defaultSettings: ProviderSettingsSchema.optional().catch(undefined),
})

const CustomProviderBaseInfoSchema = BuiltinProviderBaseInfoSchema.extend({
  id: z.string(),
  iconUrl: z.string().optional().catch(undefined),
  isCustom: z.literal(true),
})

const ProviderBaseInfoSchema = z.discriminatedUnion('isCustom', [
  BuiltinProviderBaseInfoSchema,
  CustomProviderBaseInfoSchema,
])

const ClaudeParamsSchema = z.object({
  thinking: z.object({
    type: z.enum(['enabled', 'disabled']).default('enabled'),
    budgetTokens: z.number().catch(1024),
  }),
})

export const OpenAIReasoningEffortSchema = z.enum(['low', 'medium', 'high'])
export type OpenAIReasoningEffort = z.infer<typeof OpenAIReasoningEffortSchema>

const OpenAIParamsSchema = z.object({
  reasoningEffort: OpenAIReasoningEffortSchema.optional().catch(undefined),
})

const GoogleParamsSchema = z.object({
  thinkingConfig: z.object({
    thinkingBudget: z.number().catch(1024),
    includeThoughts: z.boolean().catch(true),
  }),
})

export const ProviderOptionsSchema = z.object({
  claude: ClaudeParamsSchema.optional(),
  openai: OpenAIParamsSchema.optional(),
  google: GoogleParamsSchema.optional(),
})

// NOTICE: Global settings is for new session default settings, set to session when session created, changes will not affect existing sessions
export const GlobalSessionSettingsSchema = z.object({
  maxContextMessageCount: z.number().optional().catch(undefined),
  temperature: z.number().optional().catch(undefined),
  topP: z.number().optional().catch(undefined),
  maxTokens: z.number().optional().catch(undefined),
  stream: z.boolean().optional().catch(true),
  providerOptions: ProviderOptionsSchema.optional().catch(undefined),
})

export const SessionSettingsSchema = GlobalSessionSettingsSchema.extend({
  provider: z.string().optional().catch(undefined),
  modelId: z.string().optional().catch(undefined),
  dalleStyle: z.enum(['vivid', 'natural']).optional().catch('vivid'),
  imageGenerateNum: z.number().optional().catch(1),
  preserveReasoningInContext: z.boolean().optional().catch(true),
  autoCompaction: z.boolean().optional().catch(undefined),
  planMode: z.boolean().optional().catch(undefined),
  openclawAgentId: z.string().optional().catch(undefined),
  /**
   * Per-chat memory auto-save / tool-retain opt-out.
   * - undefined | true → inherit global Memory auto-save / allow tool retain
   * - false → do not auto-extract or model-retain from this chat (manual save still allowed)
   */
  memoryAutoSave: z.boolean().optional().catch(undefined),
})

const UnifiedTokenUsageDetailSchema = z.object({
  type: z.string(), // "plan" | "trial" | ... (more types in future)
  token_usage: z.number(),
  token_limit: z.number(),
})

const ChatboxAILicenseDetailSchema = z.object({
  type: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  name: z.string(),
  status: z.string().optional(),
  defaultModel: z.enum(['chatboxai-3.5', 'chatboxai-4']).optional(),
  remaining_quota_35: z.number(),
  remaining_quota_4: z.number(),
  remaining_quota_image: z.number(),
  image_used_count: z.number(),
  image_total_quota: z.number(),
  plan_image_limit: z.number(),
  token_refreshed_time: z.string(),
  token_next_refresh_time: z.string().optional(),
  token_expire_time: z.string().nullish(),
  remaining_quota_unified: z.number(),
  expansion_pack_limit: z.number(),
  expansion_pack_usage: z.number(),
  unified_token_usage: z.number(),
  unified_token_limit: z.number(),
  unified_token_usage_details: z.array(UnifiedTokenUsageDetailSchema).default([]),
  key: z.string().optional(),
  price_type: z.string().optional(),
  order_type: z.string().optional(),
  utm_source: z.string().optional(),
  expires_at: z.string().optional(),
  recurring_canceled: z.boolean().nullish(),
  payment_type: z.string().optional(),
})

export const shortcutSendValues = [
  '',
  'Enter',
  'Ctrl+Enter',
  'Command+Enter',
  'Shift+Enter',
  'Ctrl+Shift+Enter',
  'CommandOrControl+Enter',
]
const ShortcutSendValueSchema = z.enum(shortcutSendValues as [string, ...string[]])

export const shortcutToggleWindowValues = [
  '',
  'CommandOrControl+Shift+Space',
  'Alt+`',
  'Alt+Space',
  'Ctrl+Alt+Space',
  'Ctrl+Space',
]
const ShortcutToggleWindowValueSchema = z.enum(shortcutToggleWindowValues as [string, ...string[]])

const ShortcutSettingSchema = z.object({
  quickToggle: ShortcutToggleWindowValueSchema,
  /** Global hotkey for opening quick chat with clipboard content */
  quickAttachOrOpen: z.string().default('Alt+Shift+V').catch('Alt+Shift+V'),
  /** Global hotkey for opening quick chat without clipboard import */
  quickOpen: z.string().default('Alt+Shift+Space').catch('Alt+Shift+Space'),
  /** Global hotkey for interactive screenshot → attach to quick chat */
  screenshotToChat: z.string().default('Alt+Shift+S').catch('Alt+Shift+S'),
  /** Hold-to-talk microphone (Voice Copilot) */
  voiceHold: z.string().default('Alt+Shift+M').catch('Alt+Shift+M'),
  inputBoxFocus: z.string(),
  inputBoxWebBrowsingMode: z.string(),
  newChat: z.string(),
  newPictureChat: z.string(),
  sessionListNavNext: z.string(),
  sessionListNavPrev: z.string(),
  sessionListNavTargetIndex: z.string(),
  messageListRefreshContext: z.string(),
  dialogOpenSearch: z.string(),
  optionNavUp: z.string(),
  optionNavDown: z.string(),
  optionSelect: z.string(),
  inputBoxSendMessage: ShortcutSendValueSchema,
  inputBoxSendMessageWithoutResponse: ShortcutSendValueSchema,
})

const HistorySyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().optional().catch(undefined),
  token: z.string().optional().catch(undefined),
  passphrase: z.string().optional().catch(undefined),
  autoSync: z.boolean().default(false),
  intervalSeconds: z.number().min(15).max(3600).default(60),
})

export const MemorySyncConfigSchema = z.object({
  enabled: z.boolean().default(false),
  endpoint: z.string().default(''),
  token: z.string().default(''),
  autoSync: z.boolean().default(false),
  intervalSeconds: z.number().default(60),
})

/** Local OS system notifications (not remote push). Default off. */
export const SystemNotificationsConfigSchema = z.object({
  enabled: z.boolean().default(false).catch(false),
  notifyOnNeedsYou: z.boolean().default(true).catch(true),
  /** Long runs (chat, team room, Swarm) that finish in the background. */
  notifyOnGenerationComplete: z.boolean().default(true).catch(true),
  /** Unused since slice 08 (room runs count as long runs); kept so stored settings still load. */
  notifyOnRoomComplete: z.boolean().default(true).catch(true),
  /** Unused since slice 08 (no update notifications); kept so stored settings still load. */
  notifyOnUpdateAvailable: z.boolean().default(true).catch(true),
})

const ExtensionSettingsSchema = z.object({
  webSearch: z.object({
    provider: z.enum(['build-in', 'bing', 'duckduckgo', 'serper', 'google', 'tavily', 'exa']),
    serperApiKey: z.string().optional().catch(undefined),
    googleApiKey: z.string().optional().catch(undefined),
    googleCseId: z.string().optional().catch(undefined),
    tavilyApiKey: z.string().optional().catch(undefined),
    tavilySearchDepth: z.string().optional().catch(undefined),
    tavilyMaxResults: z.number().optional().catch(undefined),
    tavilyTimeRange: z.string().optional().catch(undefined),
    tavilyIncludeRawContent: z.string().optional().catch(undefined),
    exaApiKey: z.string().optional().catch(undefined),
    useGoogleGroundingForGemini: z.boolean().optional().catch(undefined),
    scrapeTopResults: z.boolean().optional().catch(undefined),
  }),
  knowledgeBase: z
    .object({
      models: z.object({
        embedding: z
          .object({
            modelId: z.string(),
            providerId: z.string(),
          })
          .nullable()
          .optional(),
        rerank: z
          .object({
            modelId: z.string(),
            providerId: z.string(),
          })
          .nullable()
          .optional(),
      }),
    })
    .optional(),
  // Document parser configuration for global default
  documentParser: DocumentParserConfigSchema.optional(),
  historySync: HistorySyncConfigSchema.optional().catch(undefined),
  memorySync: MemorySyncConfigSchema.optional().catch(undefined),
  /** Local OS system notifications (desktop/web/mobile; not remote push) */
  notifications: SystemNotificationsConfigSchema.optional().catch(undefined),
  /** Read public video URLs (YouTube/Vimeo/TikTok/Facebook) in agent tools */
  videoUrl: z
    .object({
      enabled: z.boolean().default(true).catch(true),
      provider: z.enum(['none', 'supadata', 'custom']).default('none').catch('none'),
      apiKey: z.string().optional().catch(undefined),
      customEndpoint: z.string().optional().catch(undefined),
      sttProvider: z.enum(['none', 'openai']).default('none').catch('none'),
      sttApiKey: z.string().optional().catch(undefined),
      preferCaptions: z.boolean().default(true).catch(true),
      maxTranscriptChars: z.number().int().min(500).max(50_000).default(12_000).catch(12_000),
      maxSttDurationSec: z.number().int().min(60).max(7200).default(1800).catch(1800),
      desktopExtractorEnabled: z.boolean().default(false).catch(false),
      desktopExtractorPath: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  /** Desktop agent browser (isolated Chromium) — master switch off by default */
  browserAgent: z
    .object({
      enabled: z.boolean().default(false).catch(false),
      headless: z.boolean().default(false).catch(false),
      maxStepsPerTurn: z.number().int().min(1).max(50).default(12).catch(12),
      /** Optional domain allowlist; empty = off (D15) */
      allowlist: z.array(z.string()).default([]).catch([]),
    })
    .optional()
    .catch(undefined),
  /** Desktop computer use — master off by default (D7) */
  computerUse: z
    .object({
      enabled: z.boolean().default(false).catch(false),
      maxScreenshotsPerTurn: z.number().int().min(1).max(30).default(16).catch(16),
      abortHotkey: z.string().optional().catch(undefined),
      /** Empty = all apps; non-empty = only these names may be opened via computer_open_app */
      appAllowlist: z.array(z.string()).default([]).catch([]),
      /** Record last N computer tool steps for export (no image dump by default) */
      debugTrajectory: z.boolean().default(false).catch(false),
    })
    .optional()
    .catch(undefined),
  /** Hold-to-talk STT + optional TTS. Uses user OpenAI/Groq keys or local Whisper. */
  voiceCopilot: z
    .object({
      enabled: z.boolean().default(false).catch(false),
      sttProvider: z.enum(['local-whisper', 'openai', 'groq']).default('openai').catch('openai'),
      ttsProvider: z.enum(['off', 'openai', 'groq']).default('off').catch('off'),
      localWhisperUrl: z
        .string()
        .default('http://127.0.0.1:8080/v1/audio/transcriptions')
        .catch('http://127.0.0.1:8080/v1/audio/transcriptions'),
      sttModel: z.string().default('whisper-1').catch('whisper-1'),
      ttsModel: z.string().default('tts-1').catch('tts-1'),
      ttsVoice: z.string().default('alloy').catch('alloy'),
    })
    .optional()
    .catch(undefined),
})

const MCPTransportConfigSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()),
    env: z.record(z.string(), z.string()).optional(),
  }),
  z.object({
    type: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).optional(),
  }),
])

const MCPServerConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  transport: MCPTransportConfigSchema,
})

const MCPSettingsSchema = z.object({
  servers: z.array(MCPServerConfigSchema),
  enabledBuiltinServers: z.array(z.string()),
})

// ===== OpenClaw Gateway Config =====

export const OpenClawGatewayConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  token: z.string().optional().catch(undefined),
  lastConnected: z.number().optional().catch(undefined),
  isDefault: z.boolean().optional().catch(undefined),
  cloudflareClientId: z.string().optional().catch(undefined),
  cloudflareClientSecret: z.string().optional().catch(undefined),
})

export type OpenClawGatewayConfig = z.infer<typeof OpenClawGatewayConfigSchema>

const OpenClawSettingsSchema = z.object({
  gateways: z.array(OpenClawGatewayConfigSchema).default([]),
})

export type OpenClawSettings = z.infer<typeof OpenClawSettingsSchema>

// ===== User Personal Info =====

export const UserPersonalInfoEntrySchema = z.object({
  id: z.string(), // uuid
  key: z.string(), // e.g. "name", "company", "role"
  value: z.string(),
})

export const UserPersonalInfoSettingsSchema = z.object({
  entries: z.array(UserPersonalInfoEntrySchema).default([]),
  enableInjection: z.boolean().default(true),
})

export enum Theme {
  Dark,
  Light,
  System,
}

export const SettingsSchema = GlobalSessionSettingsSchema.extend({
  providers: z.record(z.string(), ProviderSettingsSchema).optional().catch(undefined),
  customProviders: z.array(CustomProviderBaseInfoSchema).optional().catch(undefined),
  favoritedModels: z
    .array(
      z.object({
        provider: z.string(),
        model: z.string(),
      })
    )
    .optional()
    .catch(undefined),

  // default models
  defaultChatModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  threadNamingModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  searchTermConstructionModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),
  ocrModel: z
    .object({
      provider: z.string(),
      model: z.string(),
    })
    .optional()
    .catch(undefined),

  // chatboxai
  licenseKey: z.string().optional(),
  licenseInstances: z.record(z.string(), z.string()).optional().catch(undefined),
  licenseDetail: ChatboxAILicenseDetailSchema.optional().catch(undefined),
  licenseActivationMethod: z.enum(['login', 'manual']).optional(),
  lastSelectedLicenseByUser: z.record(z.string(), z.string()).optional().catch(undefined),
  // licensekeyview UI/key， login key ，
  memorizedManualLicenseKey: z.string().optional(),

  // chat settings
  showWordCount: z.boolean().optional().catch(undefined),
  showTokenCount: z.boolean().optional().catch(undefined),
  showTokenUsed: z.boolean().optional().catch(undefined),
  showModelName: z.boolean().optional().catch(undefined),
  showMessageTimestamp: z.boolean().optional().catch(undefined),
  showFirstTokenLatency: z.boolean().optional().catch(undefined),
  showTokenSpeed: z.boolean().optional().catch(undefined),

  accentColor: z.string().optional().catch(undefined),

  theme: z.nativeEnum(Theme),
  language: z.enum([
    'en',
    'zh-Hans',
    'zh-Hant',
    'ja',
    'ko',
    'ru',
    'de',
    'fr',
    'pt-PT',
    'es',
    'ar',
    'it-IT',
    'sv',
    'nb-NO',
  ]),
  languageInited: z.boolean().optional(),
  fontSize: z.number().catch(14),
  spellCheck: z.boolean().optional(),

  startupPage: z.enum(['home', 'session']).optional(),

  // disableQuickToggleShortcut?: boolean // （，，）

  defaultPrompt: z.string().optional(), // Default prompt for new sessions

  proxy: z.string().optional(), // Proxy URL

  allowReportingAndTracking: z.boolean().optional(), // Allow error reporting and analytics

  userAvatarKey: z.string().optional(), // User avatar storage key
  defaultAssistantAvatarKey: z.string().optional(), // Default assistant avatar key

  enableMarkdownRendering: z.boolean().default(true),
  enableMermaidRendering: z.boolean().default(true),
  enableLaTeXRendering: z.boolean().default(true),
  injectDefaultMetadata: z.boolean().default(true), // Inject default metadata (model name, date)
  autoPreviewArtifacts: z.boolean().default(true), // Auto-expand artifact previews while writing
  autoCollapseCodeBlock: z.boolean().default(true), // Auto-collapse code blocks
  pasteLongTextAsAFile: z.boolean().default(true), // Paste long text as a file

  autoGenerateTitle: z.boolean().default(true),

  autoCompaction: z.boolean().default(true),
  compactionThreshold: z.number().min(0.4).max(0.9).default(0.6),
  contextOverflowBehavior: z.enum(['ask', 'auto-compact', 'truncate']).default('ask'),

  autoLaunch: z.boolean().default(false),
  autoUpdate: z.boolean().default(true), // Auto-check for updates
  betaUpdate: z.boolean().default(false), // Auto-check beta updates

  /** Keep process running in menu bar / system tray when window is closed (desktop) */
  keepInTray: z.boolean().default(true).catch(true),
  /** Floating quick chat stays above other windows */
  quickWindowAlwaysOnTop: z.boolean().default(true).catch(true),
  /** First-run toast for close-to-tray has been shown */
  trayIntroSeen: z.boolean().default(false).catch(false),

  /**
   * Trust: 'auto' applies safe actions that are not knowledge (e.g. a Gmail label, an unsent draft) and shows
   * them as Done with Undo; knowledge proposals always wait (ADR 0001). 'ask' asks first.
   * Readers use readTrustLevel().
   */
  trustLevel: z.enum(['auto', 'ask']).default('auto').catch('auto'),
  /**
   * Cost: warn before a run is expected to cost more than this many USD; 0 turns the warning off.
   * Readers use readCostWarningUsd().
   */
  costWarningUsd: z.number().min(0).default(0.5).catch(0.5),
  /**
   * Thinking: 'auto' = open in project scopes and chats with no scope, closed in client scopes;
   * 'open' always shows thinking, 'closed' keeps it collapsed. Readers use readShowThinking().
   */
  showThinking: z.enum(['auto', 'open', 'closed']).default('auto').catch('auto'),
  /**
   * Background: true pauses background work (suggestions, memory upkeep). Slice 7's background runner honours it;
   * slice 8's menu bar toggles it. Readers use readBackgroundPaused().
   */
  backgroundPaused: z.boolean().default(false).catch(false),

  shortcuts: ShortcutSettingSchema,

  /**
   * Independent Project Workspace rollout flags. Each can fail closed without
   * restoring broad renderer filesystem/shell IPC.
   */
  projectWorkspace: z
    .object({
      migrationEnabled: z.boolean().optional().catch(true),
      directoryUxEnabled: z.boolean().optional().catch(true),
      explorerEnabled: z.boolean().optional().catch(true),
      mutationEnabled: z.boolean().optional().catch(false),
      exportEnabled: z.boolean().optional().catch(false),
      scmEnabled: z.boolean().optional().catch(false),
      stagingEnabled: z.boolean().optional().catch(false),
      applyEnabled: z.boolean().optional().catch(false),
      wasiEnabled: z.boolean().optional().catch(false),
      worktreesEnabled: z.boolean().optional().catch(false),
    })
    .optional()
    .catch(undefined),

  extension: ExtensionSettingsSchema,
  mcp: MCPSettingsSchema,
  openclaw: OpenClawSettingsSchema,

  userPersonalInfo: UserPersonalInfoSettingsSchema,

  /**
   * Soft budgets for provider usage (in-app). Optional; default disabled.
   * Does not hard-block generation unless pauseWhenExceeded is true.
   */
  usageBudget: z
    .object({
      enabled: z.boolean().default(false).catch(false),
      period: z.enum(['today', '7d', '30d', 'calendar-month']).default('calendar-month').catch('calendar-month'),
      tokenLimit: z.number().positive().optional().catch(undefined),
      costLimitUsd: z.number().positive().optional().catch(undefined),
      perProvider: z
        .record(
          z.string(),
          z.object({
            tokenLimit: z.number().positive().optional().catch(undefined),
            costLimitUsd: z.number().positive().optional().catch(undefined),
          })
        )
        .optional()
        .catch(undefined),
      warnAtPercent: z.number().min(1).max(100).default(80).catch(80),
      criticalAtPercent: z.number().min(1).max(100).default(100).catch(100),
      pauseWhenExceeded: z.boolean().default(false).catch(false),
    })
    .optional()
    .catch(undefined),

  /**
   * User edits to the built-in local price table (USD per 1M tokens).
   * providerId → modelId → { input, output, cachedInput }
   */
  usagePricingOverrides: z
    .record(
      z.string(),
      z.record(
        z.string(),
        z.object({
          input: z.number(),
          output: z.number(),
          cachedInput: z.number(),
        })
      )
    )
    .optional()
    .catch(undefined),
})

// TODO: provider base info settings， session settings global settings
export type ProviderInfo = (ProviderBaseInfo | CustomProviderBaseInfo) & ProviderSettings

export type SessionSettings = z.infer<typeof SessionSettingsSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type TrustLevel = Settings['trustLevel']
export type ShowThinking = Settings['showThinking']

/** Normalisers: coerce a raw stored value to a valid one (bad values fall back to the default). */
export const readTrustLevel = (raw: unknown): TrustLevel => SettingsSchema.shape.trustLevel.parse(raw)
export const readCostWarningUsd = (raw: unknown): number => SettingsSchema.shape.costWarningUsd.parse(raw)
export const readShowThinking = (raw: unknown): ShowThinking => SettingsSchema.shape.showThinking.parse(raw)
export const readBackgroundPaused = (raw: unknown): boolean => SettingsSchema.shape.backgroundPaused.parse(raw)
export type ProviderModelInfo = z.infer<typeof ProviderModelInfoSchema>
export type ProviderBaseInfo = z.infer<typeof ProviderBaseInfoSchema>
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>
export type BuiltinProviderBaseInfo = z.infer<typeof BuiltinProviderBaseInfoSchema>
export type CustomProviderBaseInfo = z.infer<typeof CustomProviderBaseInfoSchema>
export type ClaudeParams = z.infer<typeof ClaudeParamsSchema>
export type OpenAIParams = z.infer<typeof OpenAIParamsSchema>
export type GoogleParams = z.infer<typeof GoogleParamsSchema>
export type ProviderOptions = z.infer<typeof ProviderOptionsSchema>
export type GlobalSessionSettings = z.infer<typeof GlobalSessionSettingsSchema>
export type ChatboxAILicenseDetail = z.infer<typeof ChatboxAILicenseDetailSchema>
export type UnifiedTokenUsageDetail = z.infer<typeof UnifiedTokenUsageDetailSchema>
export type ShortcutSendValue = z.infer<typeof ShortcutSendValueSchema>
export type ShortcutToggleWindowValue = z.infer<typeof ShortcutToggleWindowValueSchema>
export type ShortcutName = keyof ShortcutSetting
export type ShortcutSetting = z.infer<typeof ShortcutSettingSchema>
export type ExtensionSettings = z.infer<typeof ExtensionSettingsSchema>
export type HistorySyncConfig = z.infer<typeof HistorySyncConfigSchema>
export type MemorySyncConfig = z.infer<typeof MemorySyncConfigSchema>
export type SystemNotificationsConfig = z.infer<typeof SystemNotificationsConfigSchema>
export type MCPTransportConfig = z.infer<typeof MCPTransportConfigSchema>
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>
export type MCPSettings = z.infer<typeof MCPSettingsSchema>
export type UserPersonalInfoEntry = z.infer<typeof UserPersonalInfoEntrySchema>
export type UserPersonalInfoSettings = z.infer<typeof UserPersonalInfoSettingsSchema>

import { v4 as uuidv4 } from 'uuid'
import { type Config, ModelProviderEnum, type SessionSettings, type Settings, Theme } from './types'
import { DEFAULT_VOICE_COPILOT } from './voice-copilot'

export function settings(): Settings {
  return {
    // aiProvider: ModelProviderEnum.OpenAI,
    // openaiKey: '',
    // apiHost: 'https://api.openai.com',
    // dalleStyle: 'vivid',
    // imageGenerateNum: 3,
    // openaiUseProxy: false,

    // azureApikey: '',
    // azureDeploymentName: '',
    // azureDeploymentNameOptions: [],
    // azureDalleDeploymentName: 'dall-e-3',
    // azureEndpoint: '',
    // azureApiVersion: '2024-05-01-preview',

    // chatglm6bUrl: '', // deprecated
    // chatglmApiKey: '',
    // chatglmModel: '',

    // model: 'gpt-4o',
    // openaiCustomModelOptions: [],
    // temperature: 0.7,
    // topP: 1,
    // // openaiMaxTokens: 0,
    // // openaiMaxContextTokens: 4000,
    // openaiMaxContextMessageCount: 20,
    // // maxContextSize: "4000",
    // // maxTokens: "2048",

    // claudeApiKey: '',
    // claudeApiHost: 'https://api.anthropic.com/v1',
    // claudeModel: 'claude-3-5-sonnet-20241022',
    // claudeApiKey: '',
    // claudeApiHost: 'https://api.anthropic.com',
    // claudeModel: 'claude-3-5-sonnet-20241022',

    // chatboxAIModel: 'chatboxai-3.5',

    // geminiAPIKey: '',
    // geminiAPIHost: 'https://generativelanguage.googleapis.com',
    // geminiModel: 'gemini-1.5-pro-latest',

    // ollamaHost: 'http://127.0.0.1:11434',
    // ollamaModel: '',

    // groqAPIKey: '',
    // groqModel: 'llama3-70b-8192',

    // deepseekAPIKey: '',
    // deepseekModel: 'deepseek-chat',

    // siliconCloudKey: '',
    // siliconCloudModel: 'Qwen/Qwen2.5-7B-Instruct',

    // lmStudioHost: 'http://127.0.0.1:1234/v1',
    // lmStudioModel: '',

    // perplexityApiKey: '',
    // perplexityModel: 'llama-3.1-sonar-large-128k-online',

    // xAIKey: '',
    // xAIModel: 'grok-beta',

    // customProviders: [],

    showWordCount: false,
    showTokenCount: false,
    // Per-message token/model lines removed — use dock SessionStatusBar
    showTokenUsed: false,
    showModelName: false,
    showMessageTimestamp: false,
    showFirstTokenLatency: false,
    showTokenSpeed: false,
    userAvatarKey: '',
    defaultAssistantAvatarKey: '',
    theme: Theme.Dark, // dark-first studio shell (see docs/design-guidelines.md)
    language: 'en',
    fontSize: 14,
    spellCheck: true,

    defaultPrompt: getDefaultPrompt(),

    allowReportingAndTracking: false,

    enableMarkdownRendering: true,
    enableLaTeXRendering: true,
    enableMermaidRendering: true,
    injectDefaultMetadata: true,
    autoPreviewArtifacts: true,
    autoCollapseCodeBlock: true,
    pasteLongTextAsAFile: true,

    autoGenerateTitle: true,

    autoCompaction: true,
    compactionThreshold: 0.6,
    contextOverflowBehavior: 'ask',
    providerOptions: {
      openai: {
        reasoningEffort: 'medium',
      },
    },

    autoLaunch: false,
    autoUpdate: true,
    betaUpdate: false,

    keepInTray: true,
    quickWindowAlwaysOnTop: true,
    trayIntroSeen: false,
    trustLevel: 'auto',
    costWarningUsd: 0.5,
    showThinking: 'auto',
    backgroundPaused: false,

    shortcuts: {
      quickToggle: 'Alt+`', // Toggle quick window visibility
      quickAttachOrOpen: 'Alt+Shift+V', // Open quick chat and attach clipboard
      quickOpen: 'Alt+Shift+Space', // Open quick chat only
      screenshotToChat: 'Alt+Shift+S', // Screenshot and attach to quick chat
      voiceHold: 'Alt+Shift+M', // Hold-to-talk microphone
      inputBoxFocus: 'mod+i', // Focus input box shortcut
      inputBoxWebBrowsingMode: 'mod+e', // Toggle web browsing mode in input
      newChat: 'mod+n', // New chat shortcut
      newPictureChat: 'mod+shift+n', // New picture chat shortcut
      sessionListNavNext: 'mod+tab', // Next session shortcut
      sessionListNavPrev: 'mod+shift+tab', // Previous session shortcut
      sessionListNavTargetIndex: 'mod', // Session navigation shortcut
      messageListRefreshContext: 'mod+r', // Refresh context shortcut
      dialogOpenSearch: 'mod+k', // Open search dialog shortcut
      inputBoxSendMessage: 'Enter', // Send message shortcut
      inputBoxSendMessageWithoutResponse: 'Ctrl+Enter', // Send without generating reply
      optionNavUp: 'up', // Option navigation shortcut
      optionNavDown: 'down', // Option navigation shortcut
      optionSelect: 'enter', // Option navigation shortcut
    },
    extension: {
      webSearch: {
        provider: 'bing',
        serperApiKey: '',
        googleApiKey: '',
        googleCseId: '',
        tavilyApiKey: '',
        exaApiKey: '',
        useGoogleGroundingForGemini: true,
        scrapeTopResults: false,
      },
      knowledgeBase: {
        models: {
          embedding: undefined,
          rerank: undefined,
        },
      },
      historySync: {
        enabled: false,
        endpoint: '',
        token: '',
        passphrase: '',
        autoSync: false,
        intervalSeconds: 60,
      },
      memorySync: {
        enabled: false,
        endpoint: '',
        token: '',
        autoSync: false,
        intervalSeconds: 60,
      },
      notifications: {
        enabled: false,
        notifyOnGenerationComplete: true,
        notifyOnRoomComplete: true,
        notifyOnUpdateAvailable: true,
      },
      // documentParser is NOT set here - it uses platform-specific defaults
      // Desktop: 'local', Mobile/Web: 'none'
      // See settingsStore.ts for the platform-aware initialization logic
      documentParser: undefined,
      videoUrl: {
        enabled: true,
        provider: 'none',
        apiKey: '',
        customEndpoint: '',
        sttProvider: 'none',
        sttApiKey: '',
        preferCaptions: true,
        maxTranscriptChars: 12_000,
        maxSttDurationSec: 1800,
        desktopExtractorEnabled: false,
        desktopExtractorPath: '',
      },
      browserAgent: {
        enabled: false,
        headless: false,
        maxStepsPerTurn: 12,
        allowlist: [],
      },
      computerUse: {
        enabled: false,
        // Align with COMPUTER_USE_MIN_STEPS (16) so auto-verify shots do not starve mid-task.
        maxScreenshotsPerTurn: 16,
        abortHotkey: '',
        appAllowlist: [],
        debugTrajectory: false,
      },
      voiceCopilot: { ...DEFAULT_VOICE_COPILOT },
    },
    mcp: {
      servers: [],
      enabledBuiltinServers: [],
    },
    openclaw: {
      gateways: [],
    },
    userPersonalInfo: {
      entries: [],
      enableInjection: true,
    },
  }
}

export function newConfigs(): Config {
  return { uuid: uuidv4() }
}

export function getDefaultPrompt() {
  return 'You are a helpful assistant.'
}

export function chatSessionSettings(): SessionSettings {
  return {
    provider: ModelProviderEnum.OpenAI,
    modelId: 'gpt-4o',
    maxContextMessageCount: Number.MAX_SAFE_INTEGER,
  }
}

export function pictureSessionSettings(): SessionSettings {
  return {
    provider: ModelProviderEnum.OpenAI,
    modelId: 'gpt-image-1',
    imageGenerateNum: 1,
    dalleStyle: 'vivid',
  }
}

// Re-export through ./providers so built-in definitions register before reads.
export { getSystemProviders as SystemProviders } from './providers'

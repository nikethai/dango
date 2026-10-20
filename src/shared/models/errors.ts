export class BaseError extends Error {
  public code = 1
  constructor(message: string) {
    super(message)
  }
}

// (legacy comment removed)

export class ApiError extends BaseError {
  public code = 10001
  public responseBody: string | undefined
  /** HTTP status of the failed call, when the provider answered. */
  public status?: number
  /** How long the provider asked us to wait (Retry-After), in ms. */
  public retryAfterMs?: number
  constructor(message: string, responseBody?: string, meta?: { status?: number; retryAfterMs?: number }) {
    super('API Error: ' + message)
    this.responseBody = responseBody
    if (meta?.status !== undefined) this.status = meta.status
    if (meta?.retryAfterMs !== undefined) this.retryAfterMs = meta.retryAfterMs
  }
}

export class NetworkError extends BaseError {
  public code = 10002
  public host: string
  constructor(message: string, host: string) {
    super('Network Error: ' + message)
    this.host = host
  }
}

export class AIProviderNoImplementedPaintError extends BaseError {
  public code = 10003
  constructor(aiProvider: string) {
    super(`Current AI Provider ${aiProvider} Does Not Support Painting`)
  }
}

export class AIProviderNoImplementedChatError extends BaseError {
  public code = 10005
  constructor(aiProvider: string) {
    super(`Current AI Provider ${aiProvider} Does Not Support Chat Completions API`)
  }
}

export class OCRError extends BaseError {
  public code = 10006
  public ocrProvider: string
  public cause: Error
  constructor(ocrProvider: string, cause: Error) {
    super(`OCR Error (${ocrProvider}): ${cause.message}`)
    this.ocrProvider = ocrProvider
    this.cause = cause
  }
}

// (legacy comment removed)

// (legacy comment removed)
// (legacy comment)
// NOTE： translate script ， key， key `src/renderer/i18n/for-key-scan.ts`
export class ProviderAPIError extends BaseError {
  static codeNameMap: { [codename: string]: ProviderAPIErrorDetail } = {
    // (legacy comment removed)
    token_quota_exhausted: {
      name: 'token_quota_exhausted',
      code: 10004, // 20000
      i18nKey:
        'You have reached your current quota for the {{model}} model. Please <OpenSettingButton>go to Settings</OpenSettingButton> to switch to a different model or check your provider configuration.',
    },
    // (legacy comment removed)
    license_upgrade_required: {
      name: 'license_upgrade_required',
      code: 20001,
      i18nKey:
        'The current account configuration does not support the {{model}} model. Please <OpenSettingButton>open Settings</OpenSettingButton> and switch to another model or provider.',
    },
    // license
    expired_license: {
      name: 'expired_license',
      code: 20002,
      i18nKey: 'Authentication has expired or is invalid. Please check your provider credentials and try again.',
    },
    // license
    license_key_required: {
      name: 'license_key_required',
      code: 20003,
      i18nKey:
        'The selected model provider requires credentials that are not configured yet. Please <OpenSettingButton>open Settings</OpenSettingButton> and configure provider credentials, or choose a different provider.',
    },
    // license
    license_not_found: {
      name: 'license_not_found',
      code: 20004,
      i18nKey: 'The configured provider credentials are invalid. Please update them and try again.',
    },
    // (legacy comment removed)
    rate_limit_exceeded: {
      name: 'rate_limit_exceeded',
      code: 20005,
      i18nKey: 'You have exceeded the provider rate limit. Please try again later.',
    },
    // (legacy comment removed)
    bad_params: {
      name: 'bad_params',
      code: 20006,
      i18nKey:
        'Invalid request parameters detected. Please try again later. Persistent failures may indicate an outdated software version. Consider upgrading to access the latest performance improvements and features.',
    },
    // 。 txt、md、html、doc、docx、pdf、excel、pptx、csv ，
    file_type_not_supported: {
      name: 'file_type_not_supported',
      code: 20007,
      i18nKey:
        'File type not supported. Supported types include txt, md, html, doc, docx, pdf, excel, pptx, csv, and all text-based files, including code files.',
    },
    // (legacy comment removed)
    file_expired: {
      name: 'file_expired',
      code: 20008,
      i18nKey:
        'The file you sent has expired. To protect your privacy, all file-related cache data has been cleared. You need to create a new conversation or refresh the context, and then send the file again.',
    },
    // (legacy comment removed)
    file_not_found: {
      name: 'file_not_found',
      code: 20009,
      i18nKey:
        'The cache data for the file was not found. Please create a new conversation or refresh the context, and then send the file again.',
    },
    // (legacy comment removed)
    file_too_large: {
      name: 'file_too_large',
      code: 20010,
      i18nKey: 'The file size exceeds the limit of 50MB. Please reduce the file size and try again.',
    },
    // (legacy comment removed)
    model_not_support_file: {
      name: 'model_not_support_file',
      code: 20011,
      i18nKey:
        "The {{model}} API doesn't support document understanding. Please switch to a model with vision/document capabilities, or use local document parsing where available.",
    },
    model_not_support_file_2: {
      name: 'model_not_support_file_2',
      code: 20012,
      i18nKey:
        "The {{model}} API doesn't support document understanding. Please switch to a model with vision/document capabilities.",
    },
    // (legacy comment removed)
    model_not_support_image: {
      name: 'model_not_support_image',
      code: 20013,
      i18nKey:
        'Sorry, the current model {{model}} API itself does not support image understanding. Please switch to another model that supports vision.',
    },
    model_not_support_image_2: {
      name: 'model_not_support_image_2',
      code: 20014,
      i18nKey:
        'Vision capability is not enabled for Model {{model}}. Please enable it or set a default OCR model in <OpenSettingButton>Settings</OpenSettingButton>',
    },
    // (legacy comment removed)
    // 'model_not_support_link': {
    //     name: 'model_not_support_link',
    //     code: 20015,
    //     i18nKey: 'The {{model}} API does not support links. Please use another model that supports link processing, or download <LinkToHomePage>the desktop app</LinkToHomePage> for local processing.'
    // },
    // 'model_not_support_link_2': {
    //     name: 'model_not_support_link_2',
    //     code: 20016,
    //     i18nKey: 'The {{model}} API does not support links. Please download <LinkToHomePage>the desktop app</LinkToHomePage> for local processing.'
    // },
    model_not_support_non_text_file: {
      name: 'model_not_support_non_text_file',
      code: 20017,
      i18nKey:
        'The {{model}} API itself does not support sending files. Local parsing currently supports text-based files (including code). For richer formats, switch to a model with document capabilities or configure a document parser.',
    },
    model_not_support_non_text_file_2: {
      name: 'model_not_support_non_text_file_2',
      code: 20018,
      i18nKey:
        'The {{model}} API itself does not support sending files. Local parsing currently supports text-based files (including code).',
    },
    system_error: {
      name: 'system_error',
      code: 20019,
      i18nKey:
        'An error occurred while processing your request. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.',
    },
    unknown: {
      name: 'unknown',
      code: 20020,
      i18nKey:
        'An unknown error occurred. Please try again later. If this error continues, please send an email to hi@chatboxai.com for support.',
    },
    model_not_support_web_browsing: {
      name: 'model_not_support_web_browsing',
      code: 20021,
      i18nKey:
        'The {{model}} API itself does not support web browsing. Supported models: {{supported_web_browsing_models}}',
    },
    model_not_support_web_browsing_2: {
      name: 'model_not_support_web_browsing_2',
      code: 20022,
      i18nKey:
        'The {{model}} API itself does not support web browsing. Supported models: {{supported_web_browsing_models}}',
    },
    no_search_result: {
      name: 'no_search_result',
      code: 20023,
      i18nKey:
        'No search results found. Please use another <OpenExtensionSettingButton>search provider</OpenExtensionSettingButton> or try again later.',
    },
    chatbox_search_license_key_required: {
      name: 'chatbox_search_license_key_required',
      code: 20024,
      i18nKey:
        'The selected search provider requires credentials that are not configured yet. Please <OpenExtensionSettingButton>open Settings</OpenExtensionSettingButton> and configure the required API key, or choose a different search provider.',
    },
    tavily_api_key_required: {
      name: 'tavily_api_key_required',
      code: 20025,
      i18nKey:
        'You have selected Tavily as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
    },
    serper_api_key_required: {
      name: 'serper_api_key_required',
      code: 20035,
      i18nKey:
        'You have selected Serper as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
    },
    google_search_credentials_required: {
      name: 'google_search_credentials_required',
      code: 20036,
      i18nKey:
        'You have selected Google Custom Search as the search provider, but the API key or Search Engine ID is missing. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and complete the configuration, or choose a different search provider.',
    },
    exa_api_key_required: {
      name: 'exa_api_key_required',
      code: 20037,
      i18nKey:
        'You have selected Exa as the search provider, but an API key has not been entered yet. Please <OpenExtensionSettingButton>click here to open Settings</OpenExtensionSettingButton> and enter your API key, or choose a different search provider.',
    },
    model_not_support_tool_use: {
      name: 'model_not_support_tool_use',
      code: 20026,
      i18nKey:
        'Tool use is not enabled for Model {{model}}. Please enable it in <OpenSettingButton>provider settings</OpenSettingButton> or switch to a model that supports tool use.',
    },
    mobile_not_support_local_file_parsing: {
      name: 'mobile_not_support_local_file_parsing',
      code: 20027,
      i18nKey:
        'Mobile devices temporarily do not support local parsing of this file type. Please use text files (txt, markdown, etc.) or switch to a model/parser that supports document understanding.',
    },
    web_not_support_local_file_parsing: {
      name: 'web_not_support_local_file_parsing',
      code: 20028,
      i18nKey:
        'The web version temporarily does not support local parsing of this file type. Please use text files (txt, markdown, etc.) or switch to a model/parser that supports document understanding.',
    },
    // Document parser errors for InputBox file preprocessing
    local_parser_failed: {
      name: 'local_parser_failed',
      code: 20029,
      i18nKey:
        'Local document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to another parser.',
    },
    chatbox_ai_parser_failed: {
      name: 'chatbox_ai_parser_failed',
      code: 20030,
      i18nKey: 'Cloud document parsing failed. Please try again later.',
    },
    third_party_parser_failed: {
      name: 'third_party_parser_failed',
      code: 20031,
      i18nKey:
        'Document parsing failed. You can go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to another parser.',
    },
    third_party_parser_not_supported_in_chat: {
      name: 'third_party_parser_not_supported_in_chat',
      code: 20032,
      i18nKey:
        'Selected document parser is currently only supported in Knowledge Base. For chat file attachments, please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and switch to Local.',
    },
    mineru_api_token_required: {
      name: 'mineru_api_token_required',
      code: 20033,
      i18nKey:
        'MinerU API token is required. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and configure your MinerU API token.',
    },
    document_parser_not_configured: {
      name: 'document_parser_not_configured',
      code: 20034,
      i18nKey:
        'This file type requires a document parser. Please go to <OpenDocumentParserSettingButton>Settings</OpenDocumentParserSettingButton> and enable a supported parser.',
    },
  }
  static fromCodeName(response: string, codeName: string) {
    if (!codeName) {
      return null
    }
    if (ProviderAPIError.codeNameMap[codeName]) {
      return new ProviderAPIError(response, ProviderAPIError.codeNameMap[codeName])
    }
    return null
  }
  static getDetail(code: number) {
    if (!code) {
      return null
    }
    for (const name in ProviderAPIError.codeNameMap) {
      if (ProviderAPIError.codeNameMap[name].code === code) {
        return ProviderAPIError.codeNameMap[name]
      }
    }
    return null
  }

  public detail: ProviderAPIErrorDetail
  constructor(message: string, detail: ProviderAPIErrorDetail) {
    super(message)
    this.detail = detail
    this.code = detail.code
  }
}

interface ProviderAPIErrorDetail {
  name: string
  code: number
  i18nKey: string
}

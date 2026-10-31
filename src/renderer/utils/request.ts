import { createDesktopAwareFetch, hasDesktopHttpTransport } from '@shared/utils/desktop-http-fetch'
import platform, { isCapacitorMobile } from '@/platform'
import { ApiError, BaseError, NetworkError } from '../../shared/models/errors'
import { apiErrorFromResponse } from '../../shared/models/retry-after'
import { CHATBOX_CLOUD_ENABLED } from '../../shared/product'
import { isLocalHost } from '../../shared/utils/network_utils'
import { handleMobileRequest } from './mobile-request'

interface RequestOptions {
  method: string
  headers?: RequestInit['headers']
  body?: RequestInit['body']
  signal?: AbortSignal
  retry?: number
  useProxy?: boolean
}

async function retryRequest<T>(fn: () => Promise<T>, retry: number, url: string): Promise<T> {
  let requestError: BaseError | null = null

  for (let i = 0; i <= retry; i++) {
    try {
      return await fn()
    } catch (e) {
      // Do not retry ApiError (typically 4xx / business errors)
      if (e instanceof ApiError) {
        throw e
      }
      let origin = 'unknown'
      try {
        origin = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost').origin
      } catch {}
      requestError = e instanceof BaseError ? e : new NetworkError((e as Error).message, origin)

      if (i < retry) {
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    }
  }

  throw requestError || new Error('Unknown error')
}

function buildHeaders(options: RequestOptions, url: string): Headers {
  const headers = new Headers(options.headers)
  // Do not overwrite Content-Type if caller already set one (e.g. form-urlencoded)
  if (!headers.has('Content-Type') && !headers.has('content-type')) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.useProxy && !isLocalHost(url) && !isCapacitorMobile && !hasDesktopHttpTransport()) {
    headers.set('CHATBOX-TARGET-URI', url)
    headers.set('CHATBOX-PLATFORM', platform.type)
  }

  return headers
}

async function doRequest(url: string, options: RequestOptions): Promise<Response> {
  const { signal, retry = 3, useProxy = false, body, method } = options
  let requestUrl = url
  const headers = buildHeaders(options, url)

  // Desktop Tauri: native HTTP (reqwest) — avoids webview CORS "Load failed"
  // Prefer this over chatbox CORS proxy so API keys never leave the machine.
  if (hasDesktopHttpTransport() && !isLocalHost(url)) {
    const desktopFetch = createDesktopAwareFetch()
    const makeDesktopRequest = async () => {
      const headerRecord: Record<string, string> = {}
      headers.forEach((value, key) => {
        headerRecord[key] = value
      })
      const res = await desktopFetch(url, {
        method,
        headers: headerRecord,
        body: body ?? undefined,
        signal,
      })
      if (!res.ok) {
        const err = await res.text().catch(() => null)
        throw apiErrorFromResponse(res.status, res.headers, err ?? undefined)
      }
      return res
    }
    return retryRequest(makeDesktopRequest, retry, url)
  }

  // Legacy CORS proxy only when cloud is explicitly enabled (off by default)
  if (CHATBOX_CLOUD_ENABLED && useProxy && !isLocalHost(url) && !isCapacitorMobile) {
    const version = await platform.getVersion()
    headers.set('CHATBOX-VERSION', version || 'unknown')
    requestUrl = 'https://cors-proxy.chatboxai.app/proxy-api/completions'
  }

  const makeRequest = async () => {
    // Capacitor WKWebView/WebView fetch is CORS-bound. Chat/OAuth to
    // chatgpt.com / openai.com must use native HTTP even when useProxy is false.
    if (isCapacitorMobile && !isLocalHost(url)) {
      return handleMobileRequest(requestUrl, method, headers, body, signal)
    }

    const res = await fetch(requestUrl, { method, headers, body, signal })
    if (!res.ok) {
      const err = await res.text().catch(() => null)
      throw apiErrorFromResponse(res.status, res.headers, err ?? undefined)
    }
    return res
  }

  return retryRequest(makeRequest, retry, requestUrl)
}

export const apiRequest = {
  async post(
    url: string,
    headers: Record<string, string>,
    body: RequestInit['body'],
    options?: Partial<RequestOptions>
  ) {
    return doRequest(url, { ...options, method: 'POST', headers, body })
  },

  async get(url: string, headers: Record<string, string>, options?: Partial<RequestOptions>) {
    return doRequest(url, { ...options, method: 'GET', headers })
  },
}

export async function fetchWithProxy(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return doRequest(input.toString(), {
    method: init?.method || 'GET',
    headers: init?.headers,
    body: init?.body,
    signal: init?.signal || undefined,
    useProxy: true,
  })
}

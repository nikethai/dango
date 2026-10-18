import '@mantine/core/styles.css'
import '@mantine/spotlight/styles.css'
import * as Sentry from '@sentry/react'
import { RouterProvider } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import 'photoswipe/dist/photoswipe.css'
import { StrictMode, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from './components/common/ErrorBoundary'
import i18n from './i18n'
import { getLogger } from './lib/utils'
import platform from './platform'
import reportWebVitals from './reportWebVitals'
import { router } from './router'
import './static/dango-tokens.css'
import './static/dango-components.css'
import './static/dango-chat.css'
import './static/dango-foundations.css'
import './static/globals.css'
import './static/index.css'
import { initLogAtom, migrationProcessAtom } from './stores/atoms/utilAtoms'
import * as migration from './stores/migration'
import queryClient from './stores/queryClient'
import { CHATBOX_BUILD_PLATFORM, CHATBOX_BUILD_TARGET } from './variables'

const log = getLogger('index')

// Load polyfills as needed
import './setup/load_polyfill'

// Sentry initialization disabled
// import './setup/sentry_init'

// Global error handling
import './setup/global_error_handler'

// GA4 initialization disabled
// import './setup/ga_init'

// Import protect module
import './setup/protect'
import { isTauriRuntime } from './platform/tauri_ipc_adapter'
import { isCapacitorMobile } from './platform'
import { QueryClientProvider } from '@tanstack/react-query'
import { initLastUsedModelStore } from './stores/lastUsedModelStore'
import { ensureMemoryStoreInit } from './stores/memoryStore'
import { initSettingsStore } from './stores/settingsStore'

// Error testing tools in development
// if (process.env.NODE_ENV === 'development') {
//   import('./utils/error-testing')
// }

// Token estimation system initialization (runs in all environments)
import('./setup/token_estimation_init')

// Mobile safe-area handling for notched screens
if (CHATBOX_BUILD_TARGET === 'mobile_app' && CHATBOX_BUILD_PLATFORM === 'ios') {
  import('./setup/mobile_safe_area')
}

// Tauri Android safe area (CSS env()-based, no Capacitor dependency)
if (CHATBOX_BUILD_PLATFORM === 'android' && isTauriRuntime()) {
  import('./setup/tauri_android_safe_area')
}

// Tauri Android keyboard handling (mobile WebView keyboard can cover bottom UI)
if (CHATBOX_BUILD_PLATFORM === 'android' && isTauriRuntime()) {
  import('./setup/tauri_android_keyboard')
}

// (legacy comment removed)
async function initializeApp() {
  log.info('initializeApp')

  try {
    // (legacy comment removed)
    await migration.migrate()
    log.info('migrate done')
  } catch (e) {
    log.error('migrate error', e)
    Sentry.captureException(e as Error)
  }

  try {
    await ensureMemoryStoreInit()
    log.info('memory store ready')
  } catch (e) {
    log.error('memory store init error', e)
  }

  // storage ， block UI
  import('./setup/storage_clear')

  // mcp (desktop only — MCP is feature-flagged off on mobile)
  if (CHATBOX_BUILD_PLATFORM !== 'android') {
    import('./setup/mcp_bootstrap')
  }
}

// (legacy comment removed)

function InitPage() {
  const log = useAtomValue(initLogAtom)
  const [showLoadingLog, setShowLoadingLog] = useState(false)
  const migrationProcess = useAtomValue(migrationProcessAtom)

  return (
    <div className="flex flex-col items-center absolute top-0 left-0 w-full h-full">
      <p className="font-roboto font-normal opacity-40 mt-4 mb-2">
        {migrationProcess ? `Migrating...(${migrationProcess})` : 'loading...'}
      </p>
      <div className="">
        <div
          role="button"
          tabIndex={0}
          className="px-4 py-0 rounded-md cursor-pointer select-none text-sm text-blue-600"
          onClick={() => setShowLoadingLog(!showLoadingLog)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              setShowLoadingLog(!showLoadingLog)
              e.preventDefault()
            }
          }}
        >
          {showLoadingLog ? 'Hide Loading Log' : 'Show Loading Log'}
        </div>
      </div>
      {/* Newest logs first */}
      {showLoadingLog && (
        <pre className="whitespace-pre-wrap flex-1 overflow-y-auto m-0 p-2">{[...log].reverse().join('\n')}</pre>
      )}
    </div>
  )
}

// initializeApp1s，log
const hideSplashScreen = isCapacitorMobile
  ? () => import('@capacitor/splash-screen').then(({ SplashScreen }) => SplashScreen.hide()).catch(() => {})
  : () => {}

const tid = setTimeout(() => {
  ReactDOM.createRoot(document.getElementById('log-root') as HTMLElement).render(
    <StrictMode>
      <ErrorBoundary>
        <InitPage />
      </ErrorBoundary>
    </StrictMode>
  )
  if (isCapacitorMobile) {
    hideSplashScreen()
  }
}, 1000)

// (legacy comment removed)
initializeApp()
  .catch((e) => {
    // (legacy comment removed)
    Sentry.captureException(e)
    log.error('initializeApp error', e)
  })
  .finally(async () => {
    clearTimeout(tid)

    // (legacy comment)
    const [settings] = await Promise.all([initSettingsStore(), initLastUsedModelStore()])

    i18n.changeLanguage(settings.language)
    // (legacy comment removed)
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <StrictMode>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
          </QueryClientProvider>
        </ErrorBoundary>
      </StrictMode>
    )

    if (isCapacitorMobile) {
      hideSplashScreen()
    }
    const el = document.querySelector('.splash-screen')
    if (el) {
      el.addEventListener('animationend', () => {
        el.parentNode?.removeChild(el)
      })
      el.classList.add('splash-screen-fade-out')
    }

    if (window?.navigator?.storage) {
      navigator.storage?.persisted().then((persisted) => {
        if (!persisted) {
          navigator.storage?.persist()
        }
      })
    }

    // Auto history sync bootstrap (non-blocking)
    import('./setup/history_sync')

    // Memory sync bootstrap (non-blocking)
    void import('./setup/memory_sync').then(({ initMemorySyncBootstrap }) => {
      initMemorySyncBootstrap()
    })
  })

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals()

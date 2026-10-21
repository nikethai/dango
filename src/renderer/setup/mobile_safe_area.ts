// (legacy comment)
// ，css --mobile-safe-area-inset-top, --mobile-safe-area-inset-bottom, --mobile-safe-area-inset-left, --mobile-safe-area-inset-right
// (legacy comment)
// ， html meta viewport-fit=cover

import { SafeArea } from 'capacitor-plugin-safe-area'
import { Keyboard } from '@capacitor/keyboard'

SafeArea.getSafeAreaInsets().then(({ insets }) => {
  for (const [key, value] of Object.entries(insets)) {
    document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
  }
})

SafeArea.getStatusBarHeight().then(({ statusBarHeight }) => {
  // console.log(statusBarHeight, 'statusbarHeight');
})
;(async () => {
  // when safe-area changed
  const eventListener = await SafeArea.addListener('safeAreaChanged', (data) => {
    const { insets } = data
    for (const [key, value] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
    }
  })
  // eventListener.remove();
})()

Keyboard.addListener('keyboardWillShow', async (info) => {
  document.documentElement.style.setProperty(`--mobile-safe-area-inset-bottom`, `0px`)
  // The phone tab bar hides while the keyboard is up (dango-layout.css).
  document.documentElement.dataset.keyboard = 'open'
})

Keyboard.addListener('keyboardWillHide', () => {
  delete document.documentElement.dataset.keyboard
  SafeArea.getSafeAreaInsets().then(({ insets }) => {
    for (const [key, value] of Object.entries(insets)) {
      document.documentElement.style.setProperty(`--mobile-safe-area-inset-${key}`, `${value}px`)
    }
  })
})

// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest'

const root = document.documentElement

function setHeight(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, writable: true, configurable: true })
  window.dispatchEvent(new Event('resize'))
}

function rotate(h: number) {
  Object.defineProperty(window, 'innerHeight', { value: h, writable: true, configurable: true })
  window.dispatchEvent(new Event('orientationchange'))
  window.dispatchEvent(new Event('resize'))
}

let field: HTMLTextAreaElement

beforeAll(async () => {
  Object.defineProperty(window, 'innerHeight', { value: 844, writable: true, configurable: true })
  // The module wires itself up on import (index.tsx loads it on Tauri Android only).
  await import('./tauri_android_keyboard')
  field = document.createElement('textarea')
  document.body.appendChild(field)
})

afterEach(() => {
  field.blur()
  setHeight(844)
})

describe('Tauri Android keyboard flag (hides the phone tab bar)', () => {
  it('is set while a focused field has the viewport shrunk, and cleared on blur', () => {
    field.focus()
    setHeight(500)
    expect(root.dataset.keyboard).toBe('open')
    field.blur()
    expect(root.dataset.keyboard).toBeUndefined()
  })

  it('is cleared when the keyboard closes with the field still focused', () => {
    field.focus()
    setHeight(500)
    expect(root.dataset.keyboard).toBe('open')
    setHeight(844)
    expect(root.dataset.keyboard).toBeUndefined()
  })

  it('rotating to landscape with nothing focused never sets it', () => {
    rotate(390)
    expect(root.dataset.keyboard).toBeUndefined()
    // Focusing a field in landscape is not a keyboard by itself: the baseline is the landscape height now.
    field.focus()
    window.dispatchEvent(new Event('resize'))
    expect(root.dataset.keyboard).toBeUndefined()
    // The IME then opening in landscape does count.
    setHeight(200)
    expect(root.dataset.keyboard).toBe('open')
  })

  it('a split-screen shrink with nothing focused never sets it', () => {
    setHeight(420)
    expect(root.dataset.keyboard).toBeUndefined()
    expect(root.style.getPropertyValue('--mobile-safe-area-inset-bottom-layout')).toBe('')
  })
})

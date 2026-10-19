/**
 * DOM helpers for Slack-style inline mention chips in the composer.
 * Chips are contenteditable=false atoms; plain text serializes to @slug $name #slug @mem:tag.
 */

import { MENTION_TOKEN_RE } from '@/components/chat/mention-tokens'

export type ComposerChipKind = 'agent' | 'skill' | 'account' | 'mem'

export type ComposerChipData = {
  kind: ComposerChipKind
  /** Full token written on send, e.g. @product-manager */
  token: string
  /** Human label shown in the chip */
  label: string
  emoji?: string
  id?: string
}

const CHIP_ATTR = 'data-composer-chip'
const TOKEN_ATTR = 'data-mention-token'
const KIND_ATTR = 'data-mention-kind'

export function isComposerChipElement(node: Node | null): node is HTMLElement {
  return Boolean(node && node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).hasAttribute(CHIP_ATTR))
}

export function createComposerChipElement(chip: ComposerChipData): HTMLSpanElement {
  const el = document.createElement('span')
  el.setAttribute(CHIP_ATTR, '1')
  el.setAttribute(TOKEN_ATTR, chip.token)
  el.setAttribute(KIND_ATTR, chip.kind)
  if (chip.id) el.dataset.mentionId = chip.id
  el.contentEditable = 'false'
  el.className = `composer-inline-chip composer-inline-chip-${chip.kind}`
  el.setAttribute('role', 'inline')
  el.setAttribute('aria-label', `${chip.kind}: ${chip.label}`)

  if (chip.emoji) {
    const emo = document.createElement('span')
    emo.className = 'composer-inline-chip-emoji'
    emo.setAttribute('aria-hidden', 'true')
    emo.textContent = chip.emoji
    el.appendChild(emo)
  } else {
    const sigil = document.createElement('span')
    sigil.className = 'composer-inline-chip-sigil'
    sigil.setAttribute('aria-hidden', 'true')
    sigil.textContent = chip.kind === 'agent' ? '@' : chip.kind === 'skill' ? '$' : chip.kind === 'account' ? '#' : '◉'
    el.appendChild(sigil)
  }

  const label = document.createElement('span')
  label.className = 'composer-inline-chip-label'
  label.textContent = chip.label
  el.appendChild(label)

  return el
}

/** Serialize editor DOM → plain token string for send / drafts / pickers. */
export function serializeComposerDom(root: HTMLElement): string {
  const parts: string[] = []

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent || '')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    if (el.hasAttribute(CHIP_ATTR)) {
      parts.push(el.getAttribute(TOKEN_ATTR) || '')
      return
    }
    if (el.tagName === 'BR') {
      parts.push('\n')
      return
    }
    // Block containers (contenteditable often inserts <div>)
    const isBlock =
      el.tagName === 'DIV' || el.tagName === 'P' || el.tagName === 'LI' || el.tagName === 'SECTION'
    if (isBlock && parts.length > 0 && !parts[parts.length - 1].endsWith('\n')) {
      // New block → newline before content (except leading empty)
      if (el.previousSibling) parts.push('\n')
    }
    for (const child of Array.from(el.childNodes)) walk(child)
  }

  for (const child of Array.from(root.childNodes)) walk(child)

  // Normalize: collapse weird zero-width spaces, trim end but keep intentional trailing space after chips
  return parts
    .join('')
    .replace(/\u200B/g, '')
    .replace(/\r\n/g, '\n')
}

/** Build chip data from a raw token when hydrating drafts (best-effort label). */
export function chipDataFromToken(
  token: string,
  resolve?: (token: string) => Partial<ComposerChipData> | null
): ComposerChipData {
  const resolved = resolve?.(token)
  if (resolved?.kind && resolved.label && resolved.token) {
    return {
      kind: resolved.kind,
      token: resolved.token,
      label: resolved.label,
      emoji: resolved.emoji,
      id: resolved.id,
    }
  }

  if (token.toLowerCase().startsWith('@mem:')) {
    const slug = token.slice(5)
    return { kind: 'mem', token, label: slug || 'Memory' }
  }
  if (token.startsWith('@')) {
    const slug = token.slice(1)
    return {
      kind: 'agent',
      token,
      label: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || slug,
    }
  }
  if (token.startsWith('$')) {
    return { kind: 'skill', token, label: token.slice(1) }
  }
  if (token.startsWith('#')) {
    const slug = token.slice(1)
    return {
      kind: 'account',
      token,
      label: slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || slug,
    }
  }
  return { kind: 'agent', token, label: token }
}

/** Render serialized token string into the contenteditable root (chips + text). */
export function renderSerializedToDom(
  root: HTMLElement,
  value: string,
  resolve?: (token: string) => Partial<ComposerChipData> | null
): void {
  root.innerHTML = ''
  if (!value) return

  let last = 0
  const re = new RegExp(MENTION_TOKEN_RE.source, MENTION_TOKEN_RE.flags)
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    if (match.index > last) {
      appendTextWithBreaks(root, value.slice(last, match.index))
    }
    root.appendChild(createComposerChipElement(chipDataFromToken(match[0], resolve)))
    last = match.index + match[0].length
  }
  if (last < value.length) {
    appendTextWithBreaks(root, value.slice(last))
  }
}

function appendTextWithBreaks(parent: HTMLElement, text: string) {
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (line) parent.appendChild(document.createTextNode(line))
    if (i < lines.length - 1) parent.appendChild(document.createElement('br'))
  })
}

export function placeCaretAtEnd(el: HTMLElement) {
  el.focus()
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

export function placeCaretAfterNode(node: Node) {
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

/** Text before caret within the editor (for @ $ # trigger detection). */
export function getTextBeforeCaret(root: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return serializeComposerDom(root)
  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return serializeComposerDom(root)

  const pre = range.cloneRange()
  pre.selectNodeContents(root)
  pre.setEnd(range.startContainer, range.startOffset)

  const walkerRoot = document.createElement('div')
  walkerRoot.appendChild(pre.cloneContents())
  return serializeComposerDom(walkerRoot)
}

/**
 * Remove trailing trigger fragment before caret (e.g. "@prod", "$cod", "#wo", "@mem foo")
 * and insert a chip + trailing space.
 */
export function replaceActiveTriggerWithChip(
  root: HTMLElement,
  chip: ComposerChipData,
  triggerPattern: RegExp
): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) {
    // Fallback: append chip at end
    const chipEl = createComposerChipElement(chip)
    root.appendChild(chipEl)
    root.appendChild(document.createTextNode(' '))
    placeCaretAtEnd(root)
    return true
  }

  const range = sel.getRangeAt(0)
  if (!root.contains(range.startContainer)) return false

  // Expand left over the active trigger in the current text node
  let container = range.startContainer
  let offset = range.startOffset

  if (container.nodeType === Node.ELEMENT_NODE) {
    // caret in element — try previous text
    const el = container as HTMLElement
    if (offset > 0 && el.childNodes[offset - 1]) {
      const prev = el.childNodes[offset - 1]
      if (prev.nodeType === Node.TEXT_NODE) {
        container = prev
        offset = (prev.textContent || '').length
      }
    }
  }

  if (container.nodeType !== Node.TEXT_NODE) {
    // Insert at caret as-is
    const chipEl = createComposerChipElement(chip)
    range.insertNode(document.createTextNode(' '))
    range.insertNode(chipEl)
    placeCaretAfterNode(chipEl.nextSibling || chipEl)
    return true
  }

  const textNode = container as Text
  const full = textNode.textContent || ''
  const before = full.slice(0, offset)
  const after = full.slice(offset)
  const match = before.match(triggerPattern)
  if (!match) {
    const chipEl = createComposerChipElement(chip)
    // insert at caret
    const mid = full.slice(0, offset)
    const rest = full.slice(offset)
    const parent = textNode.parentNode
    if (!parent) return false
    const frag = document.createDocumentFragment()
    if (mid) frag.appendChild(document.createTextNode(mid))
    frag.appendChild(chipEl)
    frag.appendChild(document.createTextNode(` ${rest}`))
    parent.replaceChild(frag, textNode)
    placeCaretAfterNode(chipEl.nextSibling || chipEl)
    return true
  }

  const triggerStart = before.lastIndexOf(match[0])
  const keepBefore = before.slice(0, triggerStart)
  const parent = textNode.parentNode
  if (!parent) return false

  const chipEl = createComposerChipElement(chip)
  const frag = document.createDocumentFragment()
  if (keepBefore) frag.appendChild(document.createTextNode(keepBefore))
  frag.appendChild(chipEl)
  const spaceAndRest = after.startsWith(' ') ? after : ` ${after}`
  frag.appendChild(document.createTextNode(spaceAndRest))
  parent.replaceChild(frag, textNode)
  // Place caret after the space following the chip
  const spaceNode = chipEl.nextSibling
  if (spaceNode && spaceNode.nodeType === Node.TEXT_NODE) {
    const r = document.createRange()
    r.setStart(spaceNode, 1)
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
  } else {
    placeCaretAfterNode(chipEl)
  }
  return true
}

/** Trigger patterns for replaceActiveTriggerWithChip (match end of text-before-caret). */
export const TRIGGER_PATTERNS = {
  agent: /(?:^|[\s([{])@[^\s@]*$/,
  skill: /(?:^|[\s([{])\$[a-z0-9-]*$/i,
  account: /(?:^|[\s([{])#[a-z0-9-]*$/i,
  mem: /(?:^|[\s([{])@(?:mem|memory)(?:\s+[^\n@]*)?$/i,
  /** A skill picked from the / menu replaces the `/partial` it was found with. */
  slash: /(?:^|[\s([{])\/[a-z0-9-]*$/i,
} as const

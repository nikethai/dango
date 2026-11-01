/**
 * Clipboard image extraction for composer + Image Creator paste.
 * Prefer event.clipboardData only (no programmatic clipboard.read).
 */

export type ClipboardPasteDecision = {
  /** Image files to attach (deduped within the paste event). */
  images: File[]
  /** Plain text to insert once after image handling (if any). */
  plainText: string | null
  /** The pasted text when it is long enough to attach as a file instead (`plainText` is then null). */
  longText: string | null
  /** True when paste contained any image file representation. */
  hasImages: boolean
  /**
   * When true, callers must preventDefault and own insertion
   * (images and/or sanitized plain text).
   */
  shouldPreventDefault: boolean
}

/**
 * Weak identity for same-event dedupe.
 * Omit name/lastModified — WebKit often re-wraps one bitmap as multiple File
 * objects with different names/timestamps (files list + items list).
 */
function fileFingerprint(file: File): string {
  const type = (file.type || guessImageType(file.name) || 'application/octet-stream').toLowerCase()
  return `${type}|${file.size}`
}

function guessImageType(name: string): string | null {
  const lower = name.toLowerCase()
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  return null
}

function isImageFile(file: File | null | undefined): file is File {
  return Boolean(
    file && file.size > 0 && (file.type.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(file.name))
  )
}

function normalizeImageFile(file: File, index: number): File {
  if (file.name && file.name !== 'image.png' && file.name !== 'blob' && file.name !== 'image.jpg') {
    return file
  }
  const ext =
    file.type === 'image/jpeg' || file.type === 'image/jpg'
      ? 'jpg'
      : file.type === 'image/webp'
        ? 'webp'
        : file.type === 'image/gif'
          ? 'gif'
          : 'png'
  return new File([file], `pasted-image-${index}.${ext}`, {
    type: file.type || 'image/png',
    lastModified: file.lastModified || Date.now(),
  })
}

function collectImageFilesFromList(files: FileList | null | undefined): File[] {
  if (!files || files.length === 0) return []
  const out: File[] = []
  for (let i = 0; i < files.length; i++) {
    const file = files.item(i)
    if (isImageFile(file)) out.push(file)
  }
  return out
}

function collectImageFilesFromItems(items: DataTransferItemList | null | undefined): File[] {
  if (!items || items.length === 0) return []
  const out: File[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'file' && (item.type.startsWith('image/') || item.type === '')) {
      const file = item.getAsFile()
      if (isImageFile(file)) out.push(file)
    }
  }
  return out
}

function dedupeFiles(files: File[]): File[] {
  const seen = new Set<string>()
  const images: File[] = []
  for (const file of files) {
    const key = fileFingerprint(file)
    if (seen.has(key)) continue
    seen.add(key)
    images.push(normalizeImageFile(file, images.length))
  }
  return images
}

/**
 * Collect image Files from a paste/drop DataTransfer.
 * Prefer `files` when it already has images — WebKit often mirrors the same
 * bitmap again under `items` with a different File wrapper (duplicate paste).
 */
export function extractClipboardImages(data: DataTransfer | null | undefined): File[] {
  if (!data) return []

  const fromFiles = collectImageFilesFromList(data.files)
  if (fromFiles.length > 0) {
    return dedupeFiles(fromFiles)
  }

  return dedupeFiles(collectImageFilesFromItems(data.items))
}

/**
 * Synchronous plain-text snapshot from clipboard (empty string if absent).
 * Prefer this over async getAsString so preventDefault can still run.
 */
export function getClipboardPlainText(data: DataTransfer | null | undefined): string {
  if (!data) return ''
  try {
    return data.getData('text/plain') || ''
  } catch {
    return ''
  }
}

/**
 * Decide how a composer paste event should be handled.
 * Does not mutate the DOM or storage — pure policy.
 */
export function decideClipboardPaste(
  data: DataTransfer | null | undefined,
  options?: { pasteLongTextAsAFile?: boolean; longTextThreshold?: number }
): ClipboardPasteDecision {
  const images = extractClipboardImages(data)
  const plainText = getClipboardPlainText(data)
  const trimmed = plainText.trim()
  const longTextThreshold = options?.longTextThreshold ?? 3000
  const pasteLongTextAsAFile = options?.pasteLongTextAsAFile ?? false

  const hasImages = images.length > 0
  const isLongText = pasteLongTextAsAFile && trimmed.length > longTextThreshold

  // Own the paste when we have images, long text-as-file, or any plain text
  // (so contenteditable never gets native rich HTML insertion).
  const shouldPreventDefault = hasImages || isLongText || Boolean(plainText) || hasStringItems(data)

  // Long text becomes a file attachment — do not also insert inline.
  // Image + caption keeps caption text for one plain insertion.
  let textOut: string | null = null
  if (isLongText) {
    textOut = null
  } else if (plainText) {
    textOut = plainText
  }

  return {
    images,
    plainText: textOut,
    longText: isLongText ? plainText : null,
    hasImages,
    shouldPreventDefault,
  }
}

function hasStringItems(data: DataTransfer | null | undefined): boolean {
  if (!data?.items) return false
  for (let i = 0; i < data.items.length; i++) {
    if (data.items[i].kind === 'string') return true
  }
  return false
}

/** Non-image files from a paste event (docs, etc.). */
export function extractClipboardNonImageFiles(data: DataTransfer | null | undefined): File[] {
  if (!data) return []
  const seen = new Set<string>()
  const files: File[] = []

  const push = (file: File | null | undefined) => {
    if (!file || file.size <= 0) return
    if (isImageFile(file)) return
    const key = fileFingerprint(file)
    if (seen.has(key)) return
    seen.add(key)
    files.push(file)
  }

  const fromFiles: File[] = []
  if (data.files && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i++) {
      const file = data.files.item(i)
      if (file && file.size > 0 && !isImageFile(file)) fromFiles.push(file)
    }
  }
  if (fromFiles.length > 0) {
    for (const file of fromFiles) push(file)
    return files
  }

  if (data.items && data.items.length > 0) {
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i]
      if (item.kind === 'file' && !item.type.startsWith('image/')) {
        push(item.getAsFile())
      }
    }
  }

  return files
}

/** Short content key for resized base64 payloads (skip identical re-pastes). */
export function imagePayloadFingerprint(base64: string): string {
  // data URL prefix + length + head/tail slices — cheap and stable enough for UI dedupe
  const raw = base64.length > 120 ? base64.slice(0, 64) + base64.slice(-48) : base64
  return `${base64.length}|${raw}`
}

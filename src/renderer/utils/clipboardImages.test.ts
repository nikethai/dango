import { describe, expect, it } from 'vitest'
import {
  decideClipboardPaste,
  extractClipboardImages,
  extractClipboardNonImageFiles,
  getClipboardPlainText,
  imagePayloadFingerprint,
} from './clipboardImages'

function makeFile(name: string, type: string, size = 128, lastModified = 1): File {
  const blob = new Blob([new Uint8Array(size)], { type })
  return new File([blob], name, { type, lastModified })
}

function makeDataTransfer(opts: {
  files?: File[]
  items?: Array<{ kind: string; type: string; file?: File; string?: string }>
  plainText?: string
}): DataTransfer {
  const files = opts.files ?? []
  const items = opts.items ?? []

  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    *[Symbol.iterator]() {
      for (const f of files) yield f
    },
  } as FileList

  const itemList = items.map((item) => ({
    kind: item.kind,
    type: item.type,
    getAsFile: () => item.file ?? null,
    getAsString: (cb: (s: string) => void) => cb(item.string ?? ''),
  }))

  return {
    files: fileList,
    items: itemList as unknown as DataTransferItemList,
    types: [] as string[],
    getData: (type: string) => (type === 'text/plain' ? (opts.plainText ?? '') : ''),
    setData: () => {},
    clearData: () => {},
    setDragImage: () => {},
    dropEffect: 'none',
    effectAllowed: 'all',
  } as unknown as DataTransfer
}

describe('extractClipboardImages', () => {
  it('reads images from clipboardData.files', () => {
    const img = makeFile('shot.png', 'image/png', 200)
    const data = makeDataTransfer({ files: [img] })
    const out = extractClipboardImages(data)
    expect(out).toHaveLength(1)
    expect(out[0].type).toBe('image/png')
  })

  it('reads images from items when files is empty', () => {
    const img = makeFile('photo.jpg', 'image/jpeg', 300)
    const data = makeDataTransfer({
      files: [],
      items: [{ kind: 'file', type: 'image/jpeg', file: img }],
    })
    const out = extractClipboardImages(data)
    expect(out).toHaveLength(1)
    expect(out[0].name).toContain('photo')
  })

  it('prefers files list and ignores mirrored items wrappers', () => {
    const img = makeFile('dup.png', 'image/png', 150, 42)
    // WebKit often re-wraps the same bitmap with a different File under items.
    const mirrored = makeFile('image.png', 'image/png', 150, 99)
    const data = makeDataTransfer({
      files: [img],
      items: [{ kind: 'file', type: 'image/png', file: mirrored }],
    })
    const out = extractClipboardImages(data)
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('dup.png')
  })

  it('dedupes same size+type images inside one source list', () => {
    const a = makeFile('a.png', 'image/png', 150, 1)
    const b = makeFile('b.png', 'image/png', 150, 2)
    const data = makeDataTransfer({ files: [a, b] })
    expect(extractClipboardImages(data)).toHaveLength(1)
  })

  it('skips zero-byte and non-image files', () => {
    const empty = makeFile('empty.png', 'image/png', 0)
    const doc = makeFile('notes.txt', 'text/plain', 40)
    const data = makeDataTransfer({ files: [empty, doc] })
    expect(extractClipboardImages(data)).toHaveLength(0)
  })

  it('names generic clipboard blobs', () => {
    const img = makeFile('image.png', 'image/png', 80)
    const data = makeDataTransfer({ files: [img] })
    const out = extractClipboardImages(data)
    expect(out[0].name).toMatch(/^pasted-image-/)
  })
})

describe('decideClipboardPaste', () => {
  it('owns image-only paste and prevents default', () => {
    const img = makeFile('a.png', 'image/png', 100)
    const decision = decideClipboardPaste(makeDataTransfer({ files: [img] }))
    expect(decision.hasImages).toBe(true)
    expect(decision.shouldPreventDefault).toBe(true)
    expect(decision.images).toHaveLength(1)
  })

  it('keeps caption text when image + plain text are present', () => {
    const img = makeFile('a.png', 'image/png', 100)
    const decision = decideClipboardPaste(
      makeDataTransfer({
        files: [img],
        plainText: 'caption here',
        items: [
          { kind: 'file', type: 'image/png', file: img },
          { kind: 'string', type: 'text/plain', string: 'caption here' },
        ],
      })
    )
    expect(decision.hasImages).toBe(true)
    expect(decision.plainText).toBe('caption here')
    expect(decision.shouldPreventDefault).toBe(true)
  })

  it('prevents default for plain text so rich HTML cannot insert', () => {
    const decision = decideClipboardPaste(
      makeDataTransfer({
        plainText: 'hello',
        items: [{ kind: 'string', type: 'text/plain', string: 'hello' }],
      })
    )
    expect(decision.hasImages).toBe(false)
    expect(decision.plainText).toBe('hello')
    expect(decision.shouldPreventDefault).toBe(true)
  })

  it('flags long text for file conversion', () => {
    const long = 'x'.repeat(3001)
    const decision = decideClipboardPaste(makeDataTransfer({ plainText: long }), {
      pasteLongTextAsAFile: true,
      longTextThreshold: 3000,
    })
    expect(decision.shouldPreventDefault).toBe(true)
    // long text-as-file: do not also insert inline
    expect(decision.plainText).toBeNull()
    // …but hand the text over, so the caller can make the file from it (finding 27)
    expect(decision.longText).toBe(long)
  })

  it('leaves short text inline, with no file text', () => {
    const decision = decideClipboardPaste(makeDataTransfer({ plainText: 'short' }), {
      pasteLongTextAsAFile: true,
      longTextThreshold: 3000,
    })
    expect(decision.plainText).toBe('short')
    expect(decision.longText).toBeNull()
  })
})

describe('extractClipboardNonImageFiles + plain text', () => {
  it('extracts non-image files only', () => {
    const img = makeFile('a.png', 'image/png', 50)
    const doc = makeFile('a.txt', 'text/plain', 40)
    const data = makeDataTransfer({ files: [img, doc] })
    expect(extractClipboardNonImageFiles(data)).toHaveLength(1)
    expect(extractClipboardNonImageFiles(data)[0].name).toBe('a.txt')
  })

  it('reads plain text safely', () => {
    expect(getClipboardPlainText(makeDataTransfer({ plainText: 'hi' }))).toBe('hi')
    expect(getClipboardPlainText(null)).toBe('')
  })
})

describe('imagePayloadFingerprint', () => {
  it('matches identical payloads and differs on length', () => {
    const a = 'data:image/png;base64,AAAA' + 'x'.repeat(200)
    const b = 'data:image/png;base64,AAAA' + 'x'.repeat(200)
    const c = 'data:image/png;base64,AAAA' + 'y'.repeat(201)
    expect(imagePayloadFingerprint(a)).toBe(imagePayloadFingerprint(b))
    expect(imagePayloadFingerprint(a)).not.toBe(imagePayloadFingerprint(c))
  })
})

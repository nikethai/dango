import { existsSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

const TRAY_DIR = join(__dirname, '../../../../src-tauri/icons/tray')
const MOODS = ['idle', 'needs', 'paused'] as const
type Mood = (typeof MOODS)[number]

const VARIANTS = [
  { suffix: '-template.png', size: 18 },
  { suffix: '-template@2x.png', size: 36 },
] as const

async function decode(file: string) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height, channels: info.channels }
}

function iconPath(mood: Mood, suffix: string) {
  return join(TRAY_DIR, `mascot-${mood}${suffix}`)
}

function opaqueCount(data: Buffer, channels: number): number {
  let count = 0
  for (let i = 0; i < data.length; i += channels) if (data[i + 3] > 0) count++
  return count
}

describe('tray template icons', () => {
  for (const mood of MOODS) {
    for (const { suffix, size } of VARIANTS) {
      const name = `mascot-${mood}${suffix}`

      it(`${name} exists at ${size}×${size}`, async () => {
        const file = iconPath(mood, suffix)
        expect(existsSync(file)).toBe(true)
        const { width, height } = await decode(file)
        expect([width, height]).toEqual([size, size])
      })

      it(`${name} is a valid template (black on transparent)`, async () => {
        const { data, channels } = await decode(iconPath(mood, suffix))
        let drawn = 0
        for (let i = 0; i < data.length; i += channels) {
          if (data[i + 3] === 0) continue
          drawn++
          expect([data[i], data[i + 1], data[i + 2]]).toEqual([0, 0, 0])
        }
        expect(drawn).toBeGreaterThan(0)
      })
    }
  }

  it('the three @2x images differ pairwise', async () => {
    const images = await Promise.all(MOODS.map((mood) => decode(iconPath(mood, '-template@2x.png'))))
    for (let a = 0; a < images.length; a++) {
      for (let b = a + 1; b < images.length; b++) {
        const [left, right] = [images[a].data.toString('base64'), images[b].data.toString('base64')]
        expect(left, `${MOODS[a]} vs ${MOODS[b]}`).not.toBe(right)
      }
    }
  })

  it('the needs image has more opaque pixels than idle', async () => {
    const idle = await decode(iconPath('idle', '-template@2x.png'))
    const needs = await decode(iconPath('needs', '-template@2x.png'))
    expect(opaqueCount(needs.data, needs.channels)).toBeGreaterThan(opaqueCount(idle.data, idle.channels))
  })
})

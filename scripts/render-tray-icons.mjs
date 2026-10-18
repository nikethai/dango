#!/usr/bin/env node
// Renders the macOS menu bar template icons from src-tauri/icons/tray/mascot-<mood>.svg:
// mascot-<mood>-template.png (18 px) and mascot-<mood>-template@2x.png (36 px).
// Each SVG is rasterised at the density that yields the target size directly (no resampling),
// then rebuilt as pure black RGB plus the rendered alpha so every pixel is a valid template pixel.
// Run with `pnpm tray-icons:render` after editing an SVG; the PNGs are committed.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const TRAY_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src-tauri/icons/tray')
const MOODS = ['idle', 'needs', 'paused']
const VIEWBOX = 36
const VARIANTS = [
  { suffix: '-template.png', size: 18 },
  { suffix: '-template@2x.png', size: 36 },
]

async function render(svg, size) {
  const density = (72 * size) / VIEWBOX
  const alpha = await sharp(svg, { density })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: 0, g: 0, b: 0 } } })
    .joinChannel(alpha, { raw: { width: size, height: size, channels: 1 } })
    .png({ compressionLevel: 9 })
}

for (const mood of MOODS) {
  const svg = await readFile(join(TRAY_DIR, `mascot-${mood}.svg`))
  for (const { suffix, size } of VARIANTS) {
    const out = join(TRAY_DIR, `mascot-${mood}${suffix}`)
    await (await render(svg, size)).toFile(out)
    console.log(`wrote ${out}`)
  }
}

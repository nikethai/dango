# 2026-10-16 redesign: app icon and mascot

- `app-icon-gpt-render.png` (1254 px, RGBA): the chosen app icon, rendered by GPT. Source of truth for the look. Do not redraw it.
- Mascot: the round dark character with two oval eyes and no mouth, used inside the app (states: idle, thinking, replying, working, needs you, done, asleep, stuck). Drawn on the "Chaeboxi redesign wireframes" canvas, Redesign page.

## Shipped files (2026-10-29)

Cut from the render: the baked-in glow is removed, the tile is scaled to an exact square (the render's tile is 1054 × 1041 px), and the inside is fully opaque.

- `app-icon-1024.png` — the tile alone on transparent, edge to edge. Source for Windows, Linux, Android and the in-app logo.
- `app-icon-macos-1024.png` — the same tile at 824 px centred on a 1024 px canvas, Apple's icon grid. Source for `icon.icns` only.
- `app-icon-ios-1024.png` — opaque, on `#FDFDFD`, because iOS icons can't be transparent and iOS rounds the corners itself.
- `tauri-icon-manifest.json` — the manifest used to generate `src-tauri/icons/`.

To regenerate `src-tauri/icons/` from these:

```bash
pnpm tauri icon assets/logo-design/2026-10-16-redesign/tauri-icon-manifest.json
pnpm tauri icon assets/logo-design/2026-10-16-redesign/app-icon-macos-1024.png -o /tmp/icons-mac
cp /tmp/icons-mac/icon.icns src-tauri/icons/icon.icns
```

Copied by hand from `app-icon-1024.png` (or the iOS version where the target must be opaque):
- `src-tauri/icons/tray-icon.png` (32 px, Windows and Linux tray)
- `src/renderer/static/icon.png` (512 px; sidebar, About, wordmark, web favicon)
- `src/renderer/static/logo192.png` (opaque; web apple-touch icon)
- `website/public/favicon.png` and `website/public/og.png` (opaque)

The macOS menu bar keeps the mascot templates in `src-tauri/icons/tray/`.

## Still to do

- **Layered macOS 26 icon.** Trace the icon into three layers (tile, face, wrap with sparkle) in Icon Composer, matching the render, so the dark, clear and tinted icon styles work. Until then, macOS 26 shows the same light icon in every style. This needs Icon Composer on a Mac.
- **Old upstream icons.** `assets/icon*.png|icns|ico|svg`, `iconTemplate*` and the unused `src-tauri/icons/tray-cube-*`, `tray-icon-*` and `tray-template-*` PNGs are leftovers. Nothing in the build reads them; the relicensing plan (Task 5) deletes them.

//! Desktop shell: tray/menu-bar, close-to-tray, global shortcuts, quick window, screenshots.
#![cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

const QUICK_LABEL: &str = "quick";
const MAIN_LABEL: &str = "main";
const TRAY_ID: &str = "dango-tray";
/// Quick window: fixed width, height follows the panel within these bounds (logical px).
const QUICK_WIDTH: f64 = 620.0;
const QUICK_INITIAL_HEIGHT: f64 = 132.0;
const QUICK_MIN_HEIGHT: f64 = 112.0;
const QUICK_MAX_HEIGHT: f64 = 640.0;

pub struct ShellState {
    pub keep_in_tray: Mutex<bool>,
    pub quick_always_on_top: Mutex<bool>,
    /// Last registered accelerator strings for cleanup.
    pub registered_shortcuts: Mutex<Vec<String>>,
    /// Clipboard or screenshot payload waiting for the quick renderer to consume it.
    pub pending_clipboard_capture: Mutex<Option<Value>>,
    pub pending_screenshot_capture: Mutex<Option<Value>>,
    /// Whether the quick renderer has installed its shell event listeners.
    pub quick_renderer_ready: Mutex<bool>,
}

impl Default for ShellState {
    fn default() -> Self {
        Self {
            keep_in_tray: Mutex::new(true),
            quick_always_on_top: Mutex::new(true),
            registered_shortcuts: Mutex::new(Vec::new()),
            pending_clipboard_capture: Mutex::new(None),
            pending_screenshot_capture: Mutex::new(None),
            quick_renderer_ready: Mutex::new(false),
        }
    }
}

fn show_window(window: &WebviewWindow) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn hide_window(window: &WebviewWindow) {
    let _ = window.hide();
}

pub fn is_window_visible(window: &WebviewWindow) -> bool {
    window.is_visible().unwrap_or(false)
}

/// Exclusive UI: only one of main / quick may be visible.
pub fn show_main(app: &AppHandle) {
    hide_quick(app);
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        show_window(&window);
    }
}

pub fn hide_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        hide_window(&window);
    }
}

pub fn toggle_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_LABEL) {
        if is_window_visible(&window) && window.is_focused().unwrap_or(false) {
            hide_window(&window);
        } else {
            show_main(app);
        }
    }
}

/// Ensure the quick floating window exists (lazy create).
pub fn ensure_quick_window(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        return Ok(window);
    }

    let always_on_top = app
        .try_state::<ShellState>()
        .map(|s| *s.quick_always_on_top.lock().unwrap_or_else(|e| e.into_inner()))
        .unwrap_or(true);

    // Frameless 620 px panel; the renderer grows it with shell:setQuickHeight
    let window = WebviewWindowBuilder::new(app, QUICK_LABEL, WebviewUrl::App("index.html".into()))
        .title("Dango Quick Chat")
        .inner_size(QUICK_WIDTH, QUICK_INITIAL_HEIGHT)
        .min_inner_size(QUICK_WIDTH, QUICK_MIN_HEIGHT)
        .resizable(false)
        .decorations(false)
        .shadow(true)
        .visible(false)
        .always_on_top(always_on_top)
        .skip_taskbar(true)
        .focused(true)
        .center()
        .build()
        .map_err(|err| format!("failed to create quick window: {err}"))?;

    // Navigate frontend to compact route after load
    let _ = window.emit("shell:navigate", json!("/quick"));

    Ok(window)
}

pub fn show_quick(app: &AppHandle) -> Result<(), String> {
    // Exclusive: hide full app while floating chat is open
    hide_main(app);
    let window = ensure_quick_window(app)?;
    show_window(&window);
    let _ = window.emit("shell:navigate", json!("/quick"));
    let _ = window.emit("shell:quick-shown", json!({}));
    Ok(())
}

pub fn hide_quick(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        hide_window(&window);
    }
}

/// Height requested by the renderer, clamped to the quick window bounds. Non-numbers are ignored.
fn clamp_quick_height(raw: &Value) -> Option<f64> {
    let height = raw.as_f64()?;
    if !height.is_finite() {
        return None;
    }
    Some(height.clamp(QUICK_MIN_HEIGHT, QUICK_MAX_HEIGHT))
}

fn set_quick_height(app: &AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        let _ = window.set_size(LogicalSize::new(QUICK_WIDTH, height));
    }
}

pub fn toggle_quick(app: &AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        if is_window_visible(&window) {
            // Hide quick only — do not auto-reopen main (user can Open Full Window)
            hide_window(&window);
            return Ok(());
        }
    }
    show_quick(app)
}

pub fn set_quick_always_on_top(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut guard) = state.quick_always_on_top.lock() {
            *guard = enabled;
        }
    }
    if let Some(window) = app.get_webview_window(QUICK_LABEL) {
        let _ = window.set_always_on_top(enabled);
    }
}

pub fn set_keep_in_tray(app: &AppHandle, enabled: bool) {
    if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut guard) = state.keep_in_tray.lock() {
            *guard = enabled;
        }
    }
}

pub fn keep_in_tray_enabled(app: &AppHandle) -> bool {
    app.try_state::<ShellState>()
        .map(|s| *s.keep_in_tray.lock().unwrap_or_else(|e| e.into_inner()))
        .unwrap_or(true)
}

pub fn quit_app(app: &AppHandle) {
    app.exit(0);
}

fn normalize_accelerator(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Map Electron-style backticks / aliases to global-shortcut form
    let mapped = trimmed
        .replace("CommandOrControl", "CmdOrCtrl")
        .replace("Command", "Cmd")
        .replace("Control", "Ctrl")
        .replace("Option", "Alt");
    Some(mapped)
}

pub fn apply_shortcut_config(app: &AppHandle, config_json: &str) -> Result<(), String> {
    let value: Value =
        serde_json::from_str(config_json).map_err(|err| format!("invalid shortcut config: {err}"))?;

    let shortcut_fields = [
        ("quickToggle", "quickToggle"),
        ("quickAttachOrOpen", "quickAttachOrOpen"),
        ("quickOpen", "quickOpen"),
        ("screenshotToChat", "screenshotToChat"),
    ];
    let next: Vec<(String, &'static str)> = shortcut_fields
        .into_iter()
        .filter_map(|(field, action)| {
            value
                .get(field)
                .and_then(Value::as_str)
                .and_then(normalize_accelerator)
                .map(|acc| (acc, action))
        })
        .collect();
    for (index, (accelerator, _)) in next.iter().enumerate() {
        if next[..index]
            .iter()
            .any(|(previous, _)| previous == accelerator)
        {
            return Err(format!("duplicate shortcut accelerator '{accelerator}'"));
        }
    }

    if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut previous) = state.registered_shortcuts.lock() {
            for accelerator in previous.drain(..) {
                let _ = app.global_shortcut().unregister(accelerator.as_str());
            }
        }
    }

    for (accelerator, action) in &next {
        let action = *action;
        let shortcut: Shortcut = accelerator
            .parse()
            .map_err(|err| format!("invalid shortcut '{accelerator}': {err}"))?;

        app.global_shortcut()
            .on_shortcut(shortcut, move |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                match action {
                    "quickToggle" => {
                        let _ = toggle_quick(app);
                    }
                    "quickAttachOrOpen" => {
                        let app2 = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let payload = match read_clipboard_capture_payload() {
                                Ok(payload) => payload,
                                Err(err) => {
                                    eprintln!("[shell] clipboard capture failed: {err}");
                                    None
                                }
                            };
                            let _ = show_quick(&app2);
                            if let Some(payload) = payload {
                                let renderer_ready = app2
                                    .try_state::<ShellState>()
                                    .and_then(|state| state.quick_renderer_ready.lock().ok().map(|ready| *ready))
                                    .unwrap_or(false);
                                if renderer_ready {
                                    let _ = app2.emit("shell:clipboard-captured", payload);
                                } else if let Some(state) = app2.try_state::<ShellState>() {
                                    if let Ok(mut pending) = state.pending_clipboard_capture.lock() {
                                        *pending = Some(payload);
                                    }
                                }
                            }
                        });
                    }
                    "quickOpen" => {
                        let _ = show_quick(app);
                    }
                    "screenshotToChat" => {
                        let app2 = app.clone();
                        tauri::async_runtime::spawn(async move {
                            match capture_region_image().await {
                                Ok(payload) => {
                                    let _ = show_quick(&app2);
                                    let renderer_ready = app2
                                        .try_state::<ShellState>()
                                        .and_then(|state| state.quick_renderer_ready.lock().ok().map(|ready| *ready))
                                        .unwrap_or(false);
                                    if renderer_ready {
                                        let _ = app2.emit("shell:screenshot-captured", payload);
                                    } else if let Some(state) = app2.try_state::<ShellState>() {
                                        if let Ok(mut pending) = state.pending_screenshot_capture.lock() {
                                            *pending = Some(payload);
                                        }
                                    }
                                }
                                Err(err) => {
                                    let _ = app2.emit(
                                        "shell:screenshot-error",
                                        json!({ "message": err }),
                                    );
                                    let _ = show_quick(&app2);
                                }
                            }
                        });
                    }
                    _ => {}
                }
            })
            .map_err(|err| format!("register shortcut '{accelerator}' failed: {err}"))?;
    }

    if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut previous) = state.registered_shortcuts.lock() {
            *previous = next.into_iter().map(|(accelerator, _)| accelerator).collect();
        }
    }

    Ok(())
}

fn png_bytes_to_image(png: &[u8]) -> Result<Image<'static>, String> {
    let dyn_img = image::load_from_memory(png).map_err(|err| format!("decode tray png: {err}"))?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), w, h))
}

fn load_tray_icon() -> Result<(Image<'static>, bool), String> {
    // macOS: monochrome cube outline template (matches dock app icon, adapts light/dark).
    // Windows/Linux: full-color cube app icon.
    #[cfg(target_os = "macos")]
    {
        const CUBE_TMPL: &[u8] = include_bytes!("../icons/tray-cube-template-32.png");
        // Prefer @2x-ish 64px if available for retina menubar
        const CUBE_TMPL_2X: &[u8] = include_bytes!("../icons/tray-cube-template-64.png");
        let img = png_bytes_to_image(CUBE_TMPL_2X)
            .or_else(|_| png_bytes_to_image(CUBE_TMPL))
            .map_err(|err| format!("tray cube template: {err}"))?;
        return Ok((img, true));
    }
    #[cfg(not(target_os = "macos"))]
    {
        const TRAY_COLOR: &[u8] = include_bytes!("../icons/tray-icon.png");
        const TRAY_32: &[u8] = include_bytes!("../icons/32x32.png");
        let img = png_bytes_to_image(TRAY_COLOR).or_else(|_| png_bytes_to_image(TRAY_32))?;
        return Ok((img, false));
    }
}

/// Format accelerator for menu labels (show user-visible shortcuts).
fn menu_accel_label(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    #[cfg(target_os = "macos")]
    {
        return raw
            .replace("CommandOrControl", "⌘")
            .replace("CmdOrCtrl", "⌘")
            .replace("Command", "⌘")
            .replace("Control", "⌃")
            .replace("Ctrl", "⌃")
            .replace("Option", "⌥")
            .replace("Alt", "⌥")
            .replace("Shift", "⇧")
            .replace('+', "");
    }
    #[cfg(not(target_os = "macos"))]
    {
        raw.to_string()
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    // Read configured shortcuts if available for menu labels
    // Menu labels show default accelerators (user can change in Settings → Hotkeys)
    let (quick_acc, shot_acc) = (String::from("Alt+`"), String::from("Alt+Shift+S"));

    let quick_label = format!("Quick Chat\t{}", menu_accel_label(&quick_acc));
    let shot_label = format!("Screenshot to Chat\t{}", menu_accel_label(&shot_acc));

    let show_i = MenuItem::with_id(app, "show_main", "Open Full Window", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quick_i = MenuItem::with_id(app, "show_quick", &quick_label, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let shot_i = MenuItem::with_id(app, "screenshot", &shot_label, true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let clip_i =
        MenuItem::with_id(app, "clipboard_image", "Attach Clipboard Image", true, None::<&str>)
            .map_err(|e| e.to_string())?;
    let sep = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit_i =
        MenuItem::with_id(app, "quit", "Quit Dango", true, None::<&str>).map_err(|e| e.to_string())?;

    let menu = Menu::with_items(app, &[&quick_i, &show_i, &shot_i, &clip_i, &sep, &quit_i])
        .map_err(|e| e.to_string())?;

    let (icon, is_template) = load_tray_icon().or_else(|_| {
        app.default_window_icon()
            .cloned()
            .map(|i| (i, false))
            .ok_or_else(|| "default window icon missing".to_string())
    })?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip("Dango — Alt+` quick chat")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show_main" => show_main(app),
            "show_quick" => {
                let _ = show_quick(app);
            }
            "screenshot" => {
                let app2 = app.clone();
                tauri::async_runtime::spawn(async move {
                    match capture_region_image().await {
                        Ok(payload) => {
                            let _ = show_quick(&app2);
                            let _ = app2.emit("shell:screenshot-captured", payload);
                        }
                        Err(err) => {
                            let _ = app2.emit("shell:screenshot-error", json!({ "message": err }));
                            let _ = show_quick(&app2);
                        }
                    }
                });
            }
            "clipboard_image" => {
                match read_clipboard_image_payload() {
                    Ok(payload) => {
                        let _ = show_quick(app);
                        let _ = app.emit("shell:screenshot-captured", payload);
                    }
                    Err(err) => {
                        let _ = app.emit("shell:screenshot-error", json!({ "message": err }));
                    }
                }
            }
            "quit" => quit_app(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let _ = toggle_quick(app);
            }
        })
        .build(app)
        .map_err(|e| e.to_string())?;

    // Template only when we loaded a black-on-transparent glyph
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(is_template);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = is_template;
    }

    let _ = tray;
    Ok(())
}

/// Capture interactive region (macOS) or best-effort capture; returns JSON payload.
pub async fn capture_region_image() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        return capture_macos_region().await;
    }
    #[cfg(target_os = "windows")]
    {
        return capture_windows_region().await;
    }
    #[cfg(target_os = "linux")]
    {
        return capture_linux_region().await;
    }
    #[allow(unreachable_code)]
    Err("screenshot capture is not supported on this platform".to_string())
}

#[cfg(target_os = "macos")]
async fn capture_macos_region() -> Result<Value, String> {
    let path = std::env::temp_dir().join(format!("dango-shot-{}.png", uuid::Uuid::new_v4()));
    let path_str = path.to_string_lossy().to_string();

    // -i interactive region, -x no sound, write to path
    let status = tokio::process::Command::new("screencapture")
        .args(["-i", "-x", &path_str])
        .status()
        .await
        .map_err(|err| {
            format!(
                "failed to run screencapture (grant Screen Recording if needed): {err}"
            )
        })?;

    if !status.success() {
        // User cancelled selection often returns non-zero
        return Err("screenshot cancelled or failed".to_string());
    }

    if !path.exists() {
        return Err("screenshot cancelled".to_string());
    }

    let payload = file_to_image_payload(&path)?;
    let _ = std::fs::remove_file(&path);
    Ok(payload)
}

#[cfg(target_os = "windows")]
async fn capture_windows_region() -> Result<Value, String> {
    // Launch Snipping Tool / Screen clip; user copies selection to clipboard.
    let _ = tokio::process::Command::new("explorer")
        .arg("ms-screenclip:")
        .status()
        .await;

    // Poll clipboard for an image up to ~30s
    for _ in 0..60 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Ok(payload) = read_clipboard_image_payload() {
            return Ok(payload);
        }
    }
    Err(
        "no screenshot found on clipboard. Use Win+Shift+S then try \"Attach Clipboard Image\", or complete the snip."
            .to_string(),
    )
}

#[cfg(target_os = "linux")]
async fn capture_linux_region() -> Result<Value, String> {
    let path = std::env::temp_dir().join(format!("dango-shot-{}.png", uuid::Uuid::new_v4()));
    let path_str = path.to_string_lossy().to_string();

    // Try common tools in order
    let attempts: Vec<(&str, Vec<&str>)> = vec![
        ("gnome-screenshot", vec!["-a", "-f", &path_str]),
        ("spectacle", vec!["-r", "-b", "-o", &path_str]),
        ("scrot", vec!["-s", &path_str]),
        ("import", vec![&path_str]), // ImageMagick
    ];

    for (bin, args) in attempts {
        let result = tokio::process::Command::new(bin).args(&args).status().await;
        if let Ok(status) = result {
            if status.success() && path.exists() {
                let payload = file_to_image_payload(&path)?;
                let _ = std::fs::remove_file(&path);
                return Ok(payload);
            }
        }
    }

    // Fallback: clipboard
    if let Ok(payload) = read_clipboard_image_payload() {
        return Ok(payload);
    }

    Err(
        "screenshot tools not found. Install gnome-screenshot/spectacle/scrot, or copy an image and use Attach Clipboard Image."
            .to_string(),
    )
}

fn file_to_image_payload(path: &PathBuf) -> Result<Value, String> {
    let bytes = std::fs::read(path).map_err(|err| format!("read screenshot failed: {err}"))?;
    if bytes.is_empty() {
        return Err("screenshot file is empty".to_string());
    }
    let mime = if path.extension().and_then(|e| e.to_str()) == Some("jpg")
        || path.extension().and_then(|e| e.to_str()) == Some("jpeg")
    {
        "image/jpeg"
    } else {
        "image/png"
    };
    let b64 = STANDARD.encode(&bytes);
    Ok(json!({
        "mimeType": mime,
        "base64": b64,
        "fileName": format!("screenshot-{}", chrono_like_name()),
    }))
}

fn chrono_like_name() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}.png")
}

pub fn read_clipboard_image_payload() -> Result<Value, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|err| format!("clipboard unavailable: {err}"))?;
    clipboard_image_payload(&mut clipboard)
}

fn clipboard_image_payload(clipboard: &mut arboard::Clipboard) -> Result<Value, String> {
    let image = clipboard
        .get_image()
        .map_err(|_| "no image on clipboard".to_string())?;
    let png_bytes = rgba_to_png(image.width as u32, image.height as u32, &image.bytes)?;
    let b64 = STANDARD.encode(&png_bytes);
    Ok(json!({
        "type": "image",
        "mimeType": "image/png",
        "base64": b64,
        "fileName": format!("clipboard-{}", chrono_like_name()),
    }))
}

fn read_clipboard_capture_payload() -> Result<Option<Value>, String> {
    let mut clipboard =
        arboard::Clipboard::new().map_err(|err| format!("clipboard unavailable: {err}"))?;
    if let Ok(payload) = clipboard_image_payload(&mut clipboard) {
        return Ok(Some(payload));
    }
    let text = clipboard
        .get_text()
        .map_err(|err| format!("clipboard text unavailable: {err}"))?;
    if text.is_empty() {
        return Ok(None);
    }
    Ok(Some(json!({ "type": "text", "text": text })))
}

fn rgba_to_png(width: u32, height: u32, bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Cursor;
    let mut img_buf = image::RgbaImage::new(width, height);
    let expected = (width as usize) * (height as usize) * 4;
    if bytes.len() < expected {
        return Err("clipboard image data truncated".to_string());
    }
    for y in 0..height {
        for x in 0..width {
            let i = ((y * width + x) * 4) as usize;
            img_buf.put_pixel(
                x,
                y,
                image::Rgba([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]),
            );
        }
    }
    let mut cursor = Cursor::new(Vec::new());
    img_buf
        .write_to(&mut cursor, image::ImageFormat::Png)
        .map_err(|err| format!("png encode failed: {err}"))?;
    Ok(cursor.into_inner())
}

/// Handle shell-related IPC channels. Returns Some(result) if handled.
pub async fn handle_ipc(app: &AppHandle, channel: &str, args: &[Value]) -> Option<Result<Value, String>> {
    match channel {
        "ensureShortcutConfig" => {
            let raw = args
                .first()
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| args.first().map(|v| v.to_string()))
                .unwrap_or_else(|| "{}".to_string());
            // If frontend passes JSON string already quoted in Value::String
            let config = if let Some(Value::String(s)) = args.first() {
                s.clone()
            } else {
                raw
            };
            Some(apply_shortcut_config(app, &config).map(|_| Value::Null))
        }
        "shell:setKeepInTray" => {
            let enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(true);
            set_keep_in_tray(app, enabled);
            Some(Ok(Value::Null))
        }
        "shell:setQuickAlwaysOnTop" => {
            let enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(true);
            set_quick_always_on_top(app, enabled);
            Some(Ok(Value::Null))
        }
        "shell:quickRendererReady" => {
            let (clipboard, screenshot) = app
                .try_state::<ShellState>()
                .map(|state| {
                    if let Ok(mut ready) = state.quick_renderer_ready.lock() {
                        *ready = true;
                    }
                    let clipboard = state.pending_clipboard_capture.lock().ok().and_then(|mut p| p.take());
                    let screenshot = state.pending_screenshot_capture.lock().ok().and_then(|mut p| p.take());
                    (clipboard, screenshot)
                })
                .unwrap_or((None, None));
            if let Some(window) = app.get_webview_window(QUICK_LABEL) {
                if let Some(payload) = clipboard {
                    let _ = window.emit("shell:clipboard-captured", payload);
                }
                if let Some(payload) = screenshot {
                    let _ = window.emit("shell:screenshot-captured", payload);
                }
            }
            Some(Ok(Value::Null))
        }
        "shell:quickRendererGone" => {
            if let Some(state) = app.try_state::<ShellState>() {
                if let Ok(mut ready) = state.quick_renderer_ready.lock() {
                    *ready = false;
                }
            }
            Some(Ok(Value::Null))
        }
        "shell:showQuick" => Some(show_quick(app).map(|_| Value::Null)),
        "shell:hideQuick" => {
            hide_quick(app);
            Some(Ok(Value::Null))
        }
        "shell:setQuickHeight" => {
            if let Some(height) = args.first().and_then(clamp_quick_height) {
                set_quick_height(app, height);
            }
            Some(Ok(Value::Null))
        }
        "shell:showMain" => {
            show_main(app);
            Some(Ok(Value::Null))
        }
        "shell:openSessionInMain" => {
            let session_id = args
                .first()
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // Exclusive: close quick, show main only
            hide_quick(app);
            show_main(app);
            if !session_id.is_empty() {
                if let Some(main) = app.get_webview_window(MAIN_LABEL) {
                    let _ = main.emit("navigate-to", json!(format!("/session/{session_id}")));
                }
            }
            Some(Ok(Value::Null))
        }
        "shell:hideMain" => {
            hide_main(app);
            Some(Ok(Value::Null))
        }
        "shell:toggleMain" => {
            toggle_main(app);
            Some(Ok(Value::Null))
        }
        "shell:captureScreenshot" => Some(capture_region_image().await),
        "shell:readClipboardImage" => Some(read_clipboard_image_payload()),
        "shell:getWindowLabel" => {
            // Caller should use window label from command context; placeholder
            Some(Ok(Value::String(MAIN_LABEL.to_string())))
        }
        _ => None,
    }
}

/// Seed shell flags from persisted settings in store.
pub fn seed_from_store(app: &AppHandle, store: &std::collections::HashMap<String, Value>) {
    if let Some(settings) = store.get("settings") {
        if let Some(keep) = settings.get("keepInTray").and_then(|v| v.as_bool()) {
            set_keep_in_tray(app, keep);
        }
        if let Some(aot) = settings.get("quickWindowAlwaysOnTop").and_then(|v| v.as_bool()) {
            set_quick_always_on_top(app, aot);
        }
        if let Some(shortcuts) = settings.get("shortcuts") {
            if let Ok(s) = serde_json::to_string(shortcuts) {
                let _ = apply_shortcut_config(app, &s);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clamp_quick_height_bounds() {
        assert_eq!(clamp_quick_height(&json!(300)), Some(300.0));
        assert_eq!(clamp_quick_height(&json!(300.5)), Some(300.5));
        assert_eq!(clamp_quick_height(&json!(10)), Some(QUICK_MIN_HEIGHT));
        assert_eq!(clamp_quick_height(&json!(-50)), Some(QUICK_MIN_HEIGHT));
        assert_eq!(clamp_quick_height(&json!(5000)), Some(QUICK_MAX_HEIGHT));
        assert_eq!(clamp_quick_height(&json!(112)), Some(112.0));
        assert_eq!(clamp_quick_height(&json!(640)), Some(640.0));
    }

    #[test]
    fn clamp_quick_height_ignores_non_numbers() {
        assert_eq!(clamp_quick_height(&json!("300")), None);
        assert_eq!(clamp_quick_height(&json!(null)), None);
        assert_eq!(clamp_quick_height(&json!(true)), None);
        assert_eq!(clamp_quick_height(&json!({ "h": 300 })), None);
        assert_eq!(clamp_quick_height(&json!([300])), None);
    }
}

//! Desktop shell: tray/menu-bar, close-to-tray, global shortcuts, quick window, screenshots.
#![cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
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
/// Tray dropdown (MB1). English until the renderer's first `shell:setTrayStatus` push swaps in translations.
const TRAY_STATUS_INITIAL: &str = "Nothing needs you";
const TRAY_TOOLTIP_INITIAL: &str = "Dango · Nothing needs you";
const TRAY_PAUSE_INITIAL: &str = "Pause background work";
const TRAY_OPEN_REVIEW: &str = "Open Review";
const TRAY_QUICK_CHAT: &str = "Quick Chat";
const TRAY_OPEN_DANGO: &str = "Open Dango";
const TRAY_QUIT: &str = "Quit";
const OPEN_REVIEW_ACCELERATOR: &str = "CmdOrCtrl+1";
/// Shown on the Quick Chat row until the stored shortcut config is applied.
const QUICK_TOGGLE_DEFAULT_ACCELERATOR: &str = "CmdOrCtrl+Shift+Space";
const REVIEW_PATH: &str = "/";

/// Menu bar mood; the macOS template icon follows it, Windows/Linux keep the colour icon.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayMood {
    Idle,
    NeedsYou,
    Paused,
}

/// Tray rows updated after creation (texts, accelerator) plus the mood the icon currently shows.
#[derive(Clone)]
pub struct TrayItems {
    status: MenuItem<Wry>,
    open_review: MenuItem<Wry>,
    quick: MenuItem<Wry>,
    pause: MenuItem<Wry>,
    open_dango: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    mood: TrayMood,
}

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
    /// Set once the tray is built; `shell:setTrayStatus` and shortcut changes update these rows.
    pub tray_items: Mutex<Option<TrayItems>>,
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
            tray_items: Mutex::new(None),
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

/// Longest app path `shell:openInMain` accepts.
const MAIN_PATH_MAX_LEN: usize = 256;

/// App path the quick window may send the main window to: a string starting with a single `/`, at most
/// `MAIN_PATH_MAX_LEN` bytes, with no control characters or backslashes. Anything else is rejected.
fn main_navigate_path(raw: &Value) -> Option<String> {
    let path = raw.as_str()?;
    if path.is_empty()
        || path.len() > MAIN_PATH_MAX_LEN
        || !path.starts_with('/')
        || path.starts_with("//")
    {
        return None;
    }
    if path.chars().any(|c| c.is_control() || c == '\\') {
        return None;
    }
    Some(path.to_string())
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

/// Accelerator shown on the tray's Quick Chat row: the configured `quickToggle`, or none when unset.
fn quick_menu_accelerator(config: &Value) -> Option<String> {
    config
        .get("quickToggle")
        .and_then(Value::as_str)
        .and_then(normalize_accelerator)
}

fn set_quick_menu_accelerator(app: &AppHandle, accelerator: Option<String>) {
    // Clone the row out so the lock is not held while muda dispatches to the main thread.
    let quick = app.try_state::<ShellState>().and_then(|state| {
        state
            .tray_items
            .lock()
            .ok()
            .and_then(|items| items.as_ref().map(|i| i.quick.clone()))
    });
    if let Some(quick) = quick {
        let _ = quick.set_accelerator(accelerator);
    }
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

    set_quick_menu_accelerator(app, quick_menu_accelerator(&value));

    Ok(())
}

fn png_bytes_to_image(png: &[u8]) -> Result<Image<'static>, String> {
    let dyn_img = image::load_from_memory(png).map_err(|err| format!("decode tray png: {err}"))?;
    let rgba = dyn_img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok(Image::new_owned(rgba.into_raw(), w, h))
}

/// Maps the renderer's mood string (`TrayStatus.mood`) to a tray mood; anything unknown is idle.
fn tray_mood(raw: &str) -> TrayMood {
    match raw {
        "needs-you" | "needs" => TrayMood::NeedsYou,
        "paused" => TrayMood::Paused,
        _ => TrayMood::Idle,
    }
}

/// macOS menu bar template (black on transparent, 36 px drawn at 18 pt) for a mood.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn mood_template_png(mood: TrayMood) -> &'static [u8] {
    match mood {
        TrayMood::Idle => include_bytes!("../icons/tray/mascot-idle-template@2x.png"),
        TrayMood::NeedsYou => include_bytes!("../icons/tray/mascot-needs-template@2x.png"),
        TrayMood::Paused => include_bytes!("../icons/tray/mascot-paused-template@2x.png"),
    }
}

fn load_tray_icon(mood: TrayMood) -> Result<(Image<'static>, bool), String> {
    // macOS: monochrome mascot template for the mood (adapts to light/dark menu bars).
    // Windows/Linux: full-colour app icon; the mood shows in the status row and tooltip only.
    #[cfg(target_os = "macos")]
    {
        let img = png_bytes_to_image(mood_template_png(mood))
            .map_err(|err| format!("tray mascot template: {err}"))?;
        return Ok((img, true));
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = mood;
        const TRAY_COLOR: &[u8] = include_bytes!("../icons/tray-icon.png");
        const TRAY_32: &[u8] = include_bytes!("../icons/32x32.png");
        let img = png_bytes_to_image(TRAY_COLOR).or_else(|_| png_bytes_to_image(TRAY_32))?;
        return Ok((img, false));
    }
}

/// Menu text with `&` escaped, so muda does not read it as a mnemonic marker.
fn menu_text(raw: &str) -> String {
    raw.replace('&', "&&")
}

/// Labels for the translated rows; `None` keeps the current text.
#[derive(Debug, Default, Clone, PartialEq)]
struct TrayMenuLabels {
    open_review: Option<String>,
    quick_chat: Option<String>,
    open_dango: Option<String>,
    quit: Option<String>,
}

/// A `shell:setTrayStatus` payload, read field by field: missing, empty or mistyped fields are `None`.
#[derive(Debug, Clone, PartialEq)]
struct TrayStatusUpdate {
    mood: TrayMood,
    status_line: Option<String>,
    pause_label: Option<String>,
    tooltip: Option<String>,
    menu: TrayMenuLabels,
}

fn non_empty_str(value: Option<&Value>) -> Option<String> {
    value
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(str::to_string)
}

/// Parses the renderer's `TrayStatus` JSON (`{ mood, statusLine, pauseLabel, tooltip, menu }`). Never fails.
fn parse_tray_status(raw: &Value) -> TrayStatusUpdate {
    let menu = raw.get("menu");
    TrayStatusUpdate {
        mood: tray_mood(raw.get("mood").and_then(Value::as_str).unwrap_or("")),
        status_line: non_empty_str(raw.get("statusLine")),
        pause_label: non_empty_str(raw.get("pauseLabel")),
        tooltip: non_empty_str(raw.get("tooltip")),
        menu: TrayMenuLabels {
            open_review: non_empty_str(menu.and_then(|m| m.get("openReview"))),
            quick_chat: non_empty_str(menu.and_then(|m| m.get("quickChat"))),
            open_dango: non_empty_str(menu.and_then(|m| m.get("openDango"))),
            quit: non_empty_str(menu.and_then(|m| m.get("quit"))),
        },
    }
}

fn set_item_text(item: &MenuItem<Wry>, text: &Option<String>) {
    if let Some(text) = text {
        let _ = item.set_text(menu_text(text));
    }
}

/// Applies a status push: row texts and tooltip everywhere, the mood icon on macOS (only when it changes).
fn apply_tray_status(app: &AppHandle, update: &TrayStatusUpdate) {
    let Some(state) = app.try_state::<ShellState>() else {
        return;
    };
    // Hold the lock only to read the mood; muda setters dispatch to the main thread. The new mood is recorded only
    // once its icon is set, so a failed icon load is tried again on the next push.
    let (items, mood_changed) = {
        let Ok(guard) = state.tray_items.lock() else {
            return;
        };
        let Some(items) = guard.as_ref() else {
            return;
        };
        (items.clone(), items.mood != update.mood)
    };

    set_item_text(&items.status, &update.status_line);
    set_item_text(&items.pause, &update.pause_label);
    set_item_text(&items.open_review, &update.menu.open_review);
    set_item_text(&items.quick, &update.menu.quick_chat);
    set_item_text(&items.open_dango, &update.menu.open_dango);
    set_item_text(&items.quit, &update.menu.quit);

    // Windows/Linux keep the colour icon: there is nothing to load, so the mood is recorded at once.
    #[cfg(not(target_os = "macos"))]
    {
        if mood_changed {
            record_tray_mood(&state, update.mood);
        }
    }

    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    if let Some(tooltip) = &update.tooltip {
        let _ = tray.set_tooltip(Some(tooltip));
    }
    #[cfg(target_os = "macos")]
    {
        if mood_changed {
            if let Ok((icon, _)) = load_tray_icon(update.mood) {
                if tray.set_icon(Some(icon)).is_ok() {
                    // Re-assert the template flag for the new image (macOS)
                    let _ = tray.set_icon_as_template(true);
                    record_tray_mood(&state, update.mood);
                }
            }
        }
    }
}

/// Records the mood the tray icon now shows.
fn record_tray_mood(state: &ShellState, mood: TrayMood) {
    if let Ok(mut guard) = state.tray_items.lock() {
        if let Some(items) = guard.as_mut() {
            items.mood = mood;
        }
    }
}

pub fn setup_tray(app: &AppHandle) -> Result<(), String> {
    let item = |id: &str, text: &str, enabled: bool, accelerator: Option<&str>| {
        MenuItem::with_id(app, id, text, enabled, accelerator).map_err(|e| e.to_string())
    };
    let separator = || PredefinedMenuItem::separator(app).map_err(|e| e.to_string());

    let status_i = item("status", TRAY_STATUS_INITIAL, false, None)?;
    let review_i = item(
        "open_review",
        TRAY_OPEN_REVIEW,
        true,
        Some(OPEN_REVIEW_ACCELERATOR),
    )?;
    let quick_i = item(
        "show_quick",
        TRAY_QUICK_CHAT,
        true,
        Some(QUICK_TOGGLE_DEFAULT_ACCELERATOR),
    )?;
    let pause_i = item("pause_toggle", TRAY_PAUSE_INITIAL, true, None)?;
    let main_i = item("show_main", TRAY_OPEN_DANGO, true, None)?;
    let quit_i = item("quit", TRAY_QUIT, true, None)?;
    let (sep_status, sep_quick, sep_pause) = (separator()?, separator()?, separator()?);

    let menu = Menu::with_items(
        app,
        &[
            &status_i,
            &sep_status,
            &review_i,
            &quick_i,
            &sep_quick,
            &pause_i,
            &sep_pause,
            &main_i,
            &quit_i,
        ],
    )
    .map_err(|e| e.to_string())?;

    let (icon, is_template) = load_tray_icon(TrayMood::Idle).or_else(|_| {
        app.default_window_icon()
            .cloned()
            .map(|i| (i, false))
            .ok_or_else(|| "default window icon missing".to_string())
    })?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .menu(&menu)
        .tooltip(TRAY_TOOLTIP_INITIAL)
        // Left click opens the dropdown (MB1); Linux always shows the menu.
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open_review" => {
                show_main(app);
                let _ = app.emit_to(MAIN_LABEL, "navigate-to", REVIEW_PATH);
            }
            "show_quick" => {
                let _ = show_quick(app);
            }
            "pause_toggle" => {
                let _ = app.emit_to(MAIN_LABEL, "shell:tray-pause-toggle", json!({}));
            }
            "show_main" => show_main(app),
            "quit" => quit_app(app),
            _ => {}
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

    if let Some(state) = app.try_state::<ShellState>() {
        if let Ok(mut items) = state.tray_items.lock() {
            *items = Some(TrayItems {
                status: status_i,
                open_review: review_i,
                quick: quick_i,
                pause: pause_i,
                open_dango: main_i,
                quit: quit_i,
                mood: TrayMood::Idle,
            });
        }
    }
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
        "shell:setTrayStatus" => {
            let update = parse_tray_status(args.first().unwrap_or(&Value::Null));
            apply_tray_status(app, &update);
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
        "shell:openInMain" => match args.first().and_then(main_navigate_path) {
            Some(path) => {
                hide_quick(app);
                show_main(app);
                let _ = app.emit_to(MAIN_LABEL, "navigate-to", path);
                Some(Ok(Value::Null))
            }
            None => Some(Err(
                "shell:openInMain expects an app path starting with /".to_string()
            )),
        },
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
    fn main_navigate_path_accepts_app_paths_only() {
        assert_eq!(
            main_navigate_path(&json!("/settings/provider")).as_deref(),
            Some("/settings/provider")
        );
        assert_eq!(
            main_navigate_path(&json!("/session/abc")).as_deref(),
            Some("/session/abc")
        );
        assert_eq!(main_navigate_path(&json!("/")).as_deref(), Some("/"));
        assert_eq!(main_navigate_path(&json!("")), None);
        assert_eq!(main_navigate_path(&json!("settings/provider")), None);
        assert_eq!(main_navigate_path(&json!("https://example.com")), None);
        assert_eq!(main_navigate_path(&json!("//example.com")), None);
        assert_eq!(main_navigate_path(&json!("/a\nb")), None);
        assert_eq!(main_navigate_path(&json!("/a\\b")), None);
        assert_eq!(
            main_navigate_path(&json!(format!("/{}", "a".repeat(MAIN_PATH_MAX_LEN)))),
            None
        );
        assert_eq!(main_navigate_path(&json!(42)), None);
        assert_eq!(main_navigate_path(&json!(null)), None);
    }

    #[test]
    fn clamp_quick_height_ignores_non_numbers() {
        assert_eq!(clamp_quick_height(&json!("300")), None);
        assert_eq!(clamp_quick_height(&json!(null)), None);
        assert_eq!(clamp_quick_height(&json!(true)), None);
        assert_eq!(clamp_quick_height(&json!({ "h": 300 })), None);
        assert_eq!(clamp_quick_height(&json!([300])), None);
    }

    #[test]
    fn tray_mood_maps_known_moods_and_defaults_to_idle() {
        assert_eq!(tray_mood("idle"), TrayMood::Idle);
        assert_eq!(tray_mood("needs-you"), TrayMood::NeedsYou);
        assert_eq!(tray_mood("needs"), TrayMood::NeedsYou);
        assert_eq!(tray_mood("paused"), TrayMood::Paused);
        assert_eq!(tray_mood(""), TrayMood::Idle);
        assert_eq!(tray_mood("Paused"), TrayMood::Idle);
        assert_eq!(tray_mood("asleep"), TrayMood::Idle);
    }

    #[test]
    fn parse_tray_status_reads_full_payload() {
        let update = parse_tray_status(&json!({
            "mood": "paused",
            "statusLine": "Paused · 2 things need you",
            "pauseLabel": "Resume background work",
            "tooltip": "Dango · Paused · 2 things need you",
            "menu": { "openReview": "Open Review", "quickChat": "Quick Chat", "openDango": "Open Dango", "quit": "Quit" }
        }));
        assert_eq!(update.mood, TrayMood::Paused);
        assert_eq!(
            update.status_line.as_deref(),
            Some("Paused · 2 things need you")
        );
        assert_eq!(
            update.pause_label.as_deref(),
            Some("Resume background work")
        );
        assert_eq!(
            update.tooltip.as_deref(),
            Some("Dango · Paused · 2 things need you")
        );
        assert_eq!(update.menu.open_review.as_deref(), Some("Open Review"));
        assert_eq!(update.menu.quick_chat.as_deref(), Some("Quick Chat"));
        assert_eq!(update.menu.open_dango.as_deref(), Some("Open Dango"));
        assert_eq!(update.menu.quit.as_deref(), Some("Quit"));
    }

    #[test]
    fn parse_tray_status_tolerates_bad_json() {
        for raw in [
            json!(null),
            json!("idle"),
            json!(42),
            json!([1, 2]),
            json!({}),
        ] {
            let update = parse_tray_status(&raw);
            assert_eq!(update.mood, TrayMood::Idle);
            assert_eq!(update.status_line, None);
            assert_eq!(update.pause_label, None);
            assert_eq!(update.tooltip, None);
            assert_eq!(update.menu, TrayMenuLabels::default());
        }
        let update = parse_tray_status(&json!({
            "mood": 3,
            "statusLine": "",
            "pauseLabel": "  ",
            "tooltip": false,
            "menu": "Open Review"
        }));
        assert_eq!(update.mood, TrayMood::Idle);
        assert_eq!(update.status_line, None);
        assert_eq!(update.pause_label, None);
        assert_eq!(update.tooltip, None);
        assert_eq!(update.menu, TrayMenuLabels::default());
        let partial = parse_tray_status(
            &json!({ "mood": "needs-you", "menu": { "quit": "Beenden", "openDango": 1 } }),
        );
        assert_eq!(partial.mood, TrayMood::NeedsYou);
        assert_eq!(partial.menu.quit.as_deref(), Some("Beenden"));
        assert_eq!(partial.menu.open_dango, None);
    }

    #[test]
    fn menu_text_escapes_mnemonic_marker() {
        assert_eq!(menu_text("Nothing needs you"), "Nothing needs you");
        assert_eq!(menu_text("Q&A needs you"), "Q&&A needs you");
    }

    #[test]
    fn quick_menu_accelerator_follows_quick_toggle() {
        assert_eq!(
            quick_menu_accelerator(&json!({ "quickToggle": "CommandOrControl+Shift+Space" }))
                .as_deref(),
            Some("CmdOrCtrl+Shift+Space")
        );
        assert_eq!(
            quick_menu_accelerator(&json!({ "quickToggle": "Alt+`" })).as_deref(),
            Some("Alt+`")
        );
        assert_eq!(quick_menu_accelerator(&json!({ "quickToggle": "" })), None);
        assert_eq!(
            quick_menu_accelerator(&json!({ "quickToggle": null })),
            None
        );
        assert_eq!(quick_menu_accelerator(&json!({})), None);
    }

    #[test]
    fn mood_templates_decode_at_36_px() {
        for mood in [TrayMood::Idle, TrayMood::NeedsYou, TrayMood::Paused] {
            let image = png_bytes_to_image(mood_template_png(mood)).expect("template decodes");
            assert_eq!((image.width(), image.height()), (36, 36));
        }
        assert_ne!(
            mood_template_png(TrayMood::Idle),
            mood_template_png(TrayMood::Paused)
        );
    }
}

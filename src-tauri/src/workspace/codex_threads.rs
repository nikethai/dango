//! Read-only broker for local Codex CLI session logs (`<sessions>/YYYY/MM/DD/rollout-*.jsonl`).
//!
//! std + serde_json only. Never reads outside the sessions root, never returns full paths.

use serde_json::{json, Value};
use std::ffi::OsString;
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const DEFAULT_LIST_LIMIT: usize = 200;
pub const MAX_LIST_LIMIT: usize = 1_000;
pub const READ_MAX_CHARS: usize = 20_000;

const TITLE_CHARS: usize = 80;
/// Directory depth below the root that is walked (`YYYY/MM/DD` plus slack).
const MAX_WALK_DEPTH: usize = 5;
/// Stop walking after this many directory entries, whatever the tree holds.
const MAX_WALK_ENTRIES: usize = 100_000;
/// A JSONL line longer than this is skipped without being kept in memory.
const MAX_LINE_BYTES: usize = 1024 * 1024;
/// Bytes scanned for a title while listing.
const TITLE_SCAN_BYTES: u64 = 512 * 1024;
/// Bytes scanned for a thread's text while reading.
const READ_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_ID_LEN: usize = 512;

const NOT_FOUND: &str = "Codex thread not found";
const BAD_REQUEST: &str = "Invalid Codex threads request";

/// `$CODEX_HOME/sessions`, else `~/.codex/sessions`.
pub fn sessions_root() -> Option<PathBuf> {
    sessions_root_from(std::env::var_os("CODEX_HOME"), home_dir_os())
}

fn home_dir_os() -> Option<OsString> {
    std::env::var_os("HOME")
        .filter(|h| !h.is_empty())
        .or_else(|| std::env::var_os("USERPROFILE").filter(|h| !h.is_empty()))
}

fn sessions_root_from(codex_home: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    if let Some(codex_home) = codex_home.filter(|c| !c.is_empty()) {
        return Some(PathBuf::from(codex_home).join("sessions"));
    }
    home.filter(|h| !h.is_empty())
        .map(|h| PathBuf::from(h).join(".codex").join("sessions"))
}

/// Whether path comparison ignores case on this target (default macOS and Windows file systems).
const CASE_INSENSITIVE_PATHS: bool = cfg!(any(target_os = "macos", target_os = "windows"));

/// Resolves `.` and `..` without touching the file system.
fn lexical(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                if !out.pop() {
                    out.push(component);
                }
            }
            other => out.push(other),
        }
    }
    out
}

/// Components of `root` below `home`, or None when `root` is not inside `home`.
fn strip_home(root: &Path, home: &Path, case_insensitive: bool) -> Option<Vec<String>> {
    let root_parts: Vec<String> = root
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    let home_parts: Vec<String> = home
        .components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect();
    if home_parts.is_empty() || root_parts.len() < home_parts.len() {
        return None;
    }
    let same = root_parts.iter().zip(&home_parts).all(|(a, b)| {
        if case_insensitive {
            a.to_lowercase() == b.to_lowercase()
        } else {
            a == b
        }
    });
    same.then(|| root_parts[home_parts.len()..].to_vec())
}

/// Path for display: the home directory becomes `~`, separators become `/`. Never the full home path.
fn display_path_for(root: &Path, home: Option<&Path>, case_insensitive: bool) -> String {
    let lexical_root = lexical(root);
    if let Some(home) = home {
        let canonical = fs::canonicalize(root).ok().zip(fs::canonicalize(home).ok());
        let pairs = canonical
            .into_iter()
            .chain(std::iter::once((lexical_root.clone(), lexical(home))));
        for (r, h) in pairs {
            if let Some(rest) = strip_home(&r, &h, case_insensitive) {
                return if rest.is_empty() {
                    "~".to_string()
                } else {
                    format!("~/{}", rest.join("/"))
                };
            }
        }
    }
    slash_path(&lexical_root)
}

/// A path with its components joined by `/` (a Windows drive prefix is kept: `C:/Users/...`).
fn slash_path(path: &Path) -> String {
    let mut out = String::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => out.push_str(&prefix.as_os_str().to_string_lossy()),
            Component::RootDir => out.push('/'),
            other => {
                if !out.is_empty() && !out.ends_with('/') {
                    out.push('/');
                }
                out.push_str(&other.as_os_str().to_string_lossy());
            }
        }
    }
    out
}

fn display_path(root: &Path) -> String {
    let home = home_dir_os().map(PathBuf::from);
    display_path_for(root, home.as_deref(), CASE_INSENSITIVE_PATHS)
}

/// One path segment the broker accepts, both when walking and when resolving an id.
fn is_valid_segment(segment: &str) -> bool {
    !segment.is_empty() && segment != "." && segment != ".." && !segment.contains(['/', '\\', ':', '\0'])
}

/// A thread id: `/`-joined valid segments ending in a `rollout-*.jsonl` name.
fn is_valid_id(id: &str) -> bool {
    if id.is_empty() || id.len() > MAX_ID_LEN {
        return false;
    }
    let parts: Vec<&str> = id.split('/').collect();
    parts.iter().all(|p| is_valid_segment(p)) && parts.last().is_some_and(|name| is_rollout_name(name))
}

fn is_rollout_name(name: &str) -> bool {
    name.len() > "rollout-.jsonl".len() && name.starts_with("rollout-") && name.ends_with(".jsonl")
}

struct Entry {
    id: String,
    path: PathBuf,
    meta: fs::Metadata,
    updated_at: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Walks the root without following symlinks. Calls `visit` for each regular `rollout-*.jsonl` file.
fn walk(root: &Path, mut visit: impl FnMut(&Path, &[String], &fs::DirEntry)) {
    let mut stack: Vec<(PathBuf, Vec<String>)> = vec![(root.to_path_buf(), Vec::new())];
    let mut seen = 0usize;
    while let Some((dir, rel)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            seen += 1;
            if seen > MAX_WALK_ENTRIES {
                return;
            }
            // DirEntry::file_type does not follow symlinks: links are neither dirs nor files here.
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                continue;
            };
            if !is_valid_segment(&name) {
                continue;
            }
            if kind.is_dir() {
                if rel.len() < MAX_WALK_DEPTH {
                    let mut child = rel.clone();
                    child.push(name);
                    stack.push((entry.path(), child));
                }
            } else if kind.is_file() && is_rollout_name(&name) {
                let mut parts = rel.clone();
                parts.push(name);
                if is_valid_id(&parts.join("/")) {
                    visit(&entry.path(), &parts, &entry);
                }
            }
        }
    }
}

/// `{ found, threadCount, displayPath }`. Counts files by name only; reads no contents.
pub fn detect(root: &Path) -> Value {
    let found = root.is_dir();
    let mut count = 0usize;
    if found {
        walk(root, |_, _, _| count += 1);
    }
    json!({
        "found": found,
        "threadCount": count,
        "displayPath": display_path(root),
    })
}

fn collect(root: &Path) -> Vec<Entry> {
    let mut out = Vec::new();
    walk(root, |path, parts, entry| {
        // DirEntry::metadata does not follow symlinks.
        let Ok(meta) = entry.metadata() else {
            return;
        };
        out.push(Entry {
            id: parts.join("/"),
            path: path.to_path_buf(),
            updated_at: mtime_ms(&meta),
            meta,
        });
    });
    out
}

/// Where a page of `list` starts: after the thread `(ms, id)` in `(updatedAt, id)` order. Without an id, after every
/// thread updated at `ms`.
pub struct After<'a> {
    pub ms: u64,
    pub id: Option<&'a str>,
}

impl After<'_> {
    fn admits(&self, entry: &Entry) -> bool {
        entry.updated_at > self.ms || (entry.updated_at == self.ms && self.id.is_some_and(|id| entry.id.as_str() > id))
    }
}

/// `{ id, title, updatedAt }`, oldest first by `(updatedAt, id)`, only threads after `after`, at most `limit`.
/// Paging with the last item as the next `after` reaches every thread once, ties included; a thread written later
/// gets a newer `updatedAt` and is listed again. Titles are scanned only for the threads returned.
pub fn list(root: &Path, after: Option<After<'_>>, limit: usize) -> Vec<Value> {
    let limit = limit.min(MAX_LIST_LIMIT);
    if limit == 0 || !root.is_dir() {
        return Vec::new();
    }
    let mut entries: Vec<Entry> = collect(root)
        .into_iter()
        .filter(|e| after.as_ref().is_none_or(|after| after.admits(e)))
        .collect();
    entries.sort_by(|a, b| a.updated_at.cmp(&b.updated_at).then_with(|| a.id.cmp(&b.id)));
    entries.truncate(limit);
    entries
        .into_iter()
        .map(|e| {
            let title = open_checked(&e.path, &e.meta)
                .map(|f| scan(f, TITLE_SCAN_BYTES, 0).title)
                .unwrap_or_default();
            json!({ "id": e.id, "title": title, "updatedAt": e.updated_at })
        })
        .collect()
}

/// Validates a renderer-supplied id and resolves it to a canonical file inside the root.
fn resolve(root: &Path, id: &str) -> Result<(PathBuf, fs::Metadata), String> {
    if !is_valid_id(id) {
        return Err(NOT_FOUND.into());
    }
    let rel = Path::new(id);
    if rel.is_absolute() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(NOT_FOUND.into());
    }
    let canon_root = fs::canonicalize(root).map_err(|_| NOT_FOUND.to_string())?;
    let canon = fs::canonicalize(canon_root.join(rel)).map_err(|_| NOT_FOUND.to_string())?;
    if !canon.starts_with(&canon_root) || canon == canon_root {
        return Err(NOT_FOUND.into());
    }
    let resolved_name_ok = canon.file_name().and_then(|n| n.to_str()).is_some_and(is_rollout_name);
    if !resolved_name_ok {
        return Err(NOT_FOUND.into());
    }
    let meta = fs::symlink_metadata(&canon).map_err(|_| NOT_FOUND.to_string())?;
    if !meta.is_file() {
        return Err(NOT_FOUND.into());
    }
    Ok((canon, meta))
}

/// Opens `path` and confirms the open handle is the regular file that was checked (no swap in between).
fn open_checked(path: &Path, checked: &fs::Metadata) -> Option<File> {
    let file = File::open(path).ok()?;
    let opened = file.metadata().ok()?;
    if !opened.is_file() || !same_file(checked, &opened) {
        return None;
    }
    Some(file)
}

#[cfg(unix)]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev() && a.ino() == b.ino()
}

#[cfg(not(unix))]
fn same_file(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    same_created(a, b)
}

/// Both are regular files created at the same time. Length and mtime are not compared: Codex appends to a thread
/// while it runs, and that must not make the file look swapped.
#[cfg_attr(unix, allow(dead_code))]
fn same_created(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    a.is_file() && b.is_file() && a.created().ok() == b.created().ok()
}

/// `{ id, title, updatedAt, text, truncated }`, text capped at `max_chars` characters.
pub fn read(root: &Path, id: &str, max_chars: usize) -> Result<Value, String> {
    let (path, checked) = resolve(root, id)?;
    let file = open_checked(&path, &checked).ok_or_else(|| NOT_FOUND.to_string())?;
    let updated_at = file.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
    let scanned = scan(file, READ_SCAN_BYTES, max_chars.min(READ_MAX_CHARS));
    Ok(json!({
        "id": id,
        "title": scanned.title,
        "updatedAt": updated_at,
        "text": scanned.text,
        "truncated": scanned.truncated,
    }))
}

struct Scanned {
    title: String,
    text: String,
    truncated: bool,
}

/// Reads one line into `buf`, keeping at most `MAX_LINE_BYTES`. Returns (bytes consumed, overflowed).
fn read_line_capped(reader: &mut impl BufRead, buf: &mut Vec<u8>) -> std::io::Result<(usize, bool)> {
    buf.clear();
    let mut consumed = 0usize;
    let mut overflow = false;
    loop {
        let chunk = reader.fill_buf()?;
        if chunk.is_empty() {
            return Ok((consumed, overflow));
        }
        let (take, done) = match chunk.iter().position(|b| *b == b'\n') {
            Some(i) => (i + 1, true),
            None => (chunk.len(), false),
        };
        let room = MAX_LINE_BYTES.saturating_sub(buf.len());
        if take > room {
            overflow = true;
            buf.extend_from_slice(&chunk[..room]);
        } else {
            buf.extend_from_slice(&chunk[..take]);
        }
        reader.consume(take);
        consumed += take;
        if done {
            return Ok((consumed, overflow));
        }
    }
}

/// Scans JSONL messages. `max_chars == 0` collects only the title and stops at the first user text.
fn scan(file: File, max_bytes: u64, max_chars: usize) -> Scanned {
    let mut reader = BufReader::new(file.take(max_bytes));
    let mut out = Scanned {
        title: String::new(),
        text: String::new(),
        truncated: false,
    };
    let mut used_chars = 0usize;
    let mut total = 0u64;
    let mut buf = Vec::new();
    while let Ok((n, overflow)) = read_line_capped(&mut reader, &mut buf) {
        if n == 0 {
            break;
        }
        total += n as u64;
        if overflow {
            continue;
        }
        let Ok(line) = std::str::from_utf8(&buf) else {
            continue;
        };
        let Some((role, text)) = message_of(line.trim()) else {
            continue;
        };
        if out.title.is_empty() && role == "user" {
            out.title = text.chars().take(TITLE_CHARS).collect();
            if max_chars == 0 {
                return out;
            }
        }
        if max_chars == 0 {
            continue;
        }
        let entry = format!("{}{role}: {text}", if out.text.is_empty() { "" } else { "\n" });
        let entry_chars = entry.chars().count();
        if used_chars + entry_chars > max_chars {
            out.text.extend(entry.chars().take(max_chars - used_chars));
            out.truncated = true;
            return out;
        }
        used_chars += entry_chars;
        out.text.push_str(&entry);
    }
    if total >= max_bytes && max_chars > 0 {
        out.truncated = true;
    }
    out
}

/// A kept message as (role, one-line text), or None.
fn message_of(line: &str) -> Option<(&'static str, String)> {
    if line.is_empty() {
        return None;
    }
    let value: Value = serde_json::from_str(line).ok()?;
    let msg = match value.get("payload") {
        Some(payload) if payload.get("type").and_then(Value::as_str) == Some("message") => payload,
        _ if value.get("type").and_then(Value::as_str) == Some("message") => &value,
        _ => return None,
    };
    let role = match msg.get("role").and_then(Value::as_str) {
        Some("user") => "user",
        Some("assistant") => "assistant",
        _ => return None,
    };
    let parts: Vec<String> = msg
        .get("content")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|item| item.get("text").and_then(Value::as_str))
        .filter(|text| !is_instruction_text(text))
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some((role, parts.join(" ")))
}

/// Context that Codex injects as user messages, in older and newer log formats.
const INSTRUCTION_PREFIXES: [&str; 4] = [
    "<environment_context>",
    "<user_instructions>",
    "# AGENTS.md instructions",
    "<INSTRUCTIONS>",
];

fn is_instruction_text(text: &str) -> bool {
    let t = text.trim_start();
    INSTRUCTION_PREFIXES.iter().any(|prefix| t.starts_with(prefix))
}

fn since_of(request: &Value) -> Option<u64> {
    let raw = request.get("sinceMs")?;
    if let Some(n) = raw.as_u64() {
        return Some(n);
    }
    raw.as_f64().filter(|f| f.is_finite() && *f >= 0.0).map(|f| f as u64)
}

/// A list request's `sinceId`; anything but a valid thread id is ignored.
fn since_id_of(request: &Value) -> Option<&str> {
    request
        .get("sinceId")
        .and_then(Value::as_str)
        .filter(|id| is_valid_id(id))
}

/// `codex:threads` request: `{ op: 'detect' } | { op: 'list', sinceMs?, sinceId?, limit? } | { op: 'read', id }`.
pub fn dispatch(root: Option<&Path>, request: Option<&Value>) -> Result<Value, String> {
    let request = request
        .filter(|r| r.is_object())
        .ok_or_else(|| BAD_REQUEST.to_string())?;
    let op = request
        .get("op")
        .and_then(Value::as_str)
        .ok_or_else(|| BAD_REQUEST.to_string())?;
    match op {
        "detect" => Ok(match root {
            Some(root) => detect(root),
            None => json!({ "found": false, "threadCount": 0, "displayPath": "~/.codex/sessions" }),
        }),
        "list" => {
            let limit = request
                .get("limit")
                .and_then(Value::as_u64)
                .map(|n| n.min(MAX_LIST_LIMIT as u64) as usize)
                .unwrap_or(DEFAULT_LIST_LIMIT);
            let after = since_of(request).map(|ms| After {
                ms,
                id: since_id_of(request),
            });
            let items = root.map(|root| list(root, after, limit)).unwrap_or_default();
            Ok(Value::Array(items))
        }
        "read" => {
            let id = request
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| BAD_REQUEST.to_string())?;
            let root = root.ok_or_else(|| NOT_FOUND.to_string())?;
            read(root, id, READ_MAX_CHARS)
        }
        _ => Err(BAD_REQUEST.into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    static SEQ: AtomicU64 = AtomicU64::new(0);

    const FIXTURE: &str = concat!(
        r#"{"timestamp":"2026-10-01T10:00:00Z","type":"session_meta","payload":{"id":"abc","cwd":"/home/someone/project"}}"#,
        "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"<environment_context>cwd /home/someone</environment_context>"}]}}"#,
        "\n",
        r##"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"# AGENTS.md instructions for /home/someone/project"}]}}"##,
        "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"  <INSTRUCTIONS>be terse</INSTRUCTIONS>"}]}}"#,
        "\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Plan the launch\nfor Friday"}]}}"#,
        "\n",
        "not json at all\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Here is a plan."},{"type":"output_text","text":"Step one."}]}}"#,
        "\n",
    );

    /// Temp fixture removed when dropped.
    struct Fixture {
        base: PathBuf,
        root: PathBuf,
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.base);
        }
    }

    fn temp_base() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("dango-codex-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&base).unwrap();
        base
    }

    fn fixture() -> Fixture {
        let base = temp_base();
        let root = base.join("sessions");
        let day = root.join("2026").join("10").join("01");
        fs::create_dir_all(&day).unwrap();
        fs::write(day.join("rollout-a.jsonl"), FIXTURE).unwrap();
        fs::write(day.join("notes.txt"), "not a thread").unwrap();
        Fixture { base, root }
    }

    #[test]
    fn detect_counts_without_reading() {
        let fx = fixture();
        let root = fx.root.clone();
        // An unreadable-as-JSON rollout file still counts: detect never opens files.
        fs::write(
            root.join("2026").join("10").join("01").join("rollout-b.jsonl"),
            [0xffu8, 0xfe],
        )
        .unwrap();
        let v = detect(&root);
        assert_eq!(v["found"], json!(true));
        assert_eq!(v["threadCount"], json!(2));
        let missing = detect(&root.join("nope"));
        assert_eq!(missing["found"], json!(false));
        assert_eq!(missing["threadCount"], json!(0));
    }

    #[test]
    fn display_path_uses_tilde() {
        let home = Path::new("/home/someone");
        assert_eq!(
            display_path_for(Path::new("/home/someone/.codex/sessions"), Some(home), false),
            "~/.codex/sessions"
        );
        assert_eq!(display_path_for(Path::new("/home/someone"), Some(home), false), "~");
        assert_eq!(
            display_path_for(Path::new("/opt/codex/sessions"), Some(home), false),
            "/opt/codex/sessions"
        );
        // A sibling whose name merely starts with the home name is not under home.
        assert_eq!(
            display_path_for(Path::new("/home/someone-else/s"), Some(home), false),
            "/home/someone-else/s"
        );
    }

    #[test]
    fn display_path_resolves_dot_dot_in_codex_home() {
        // Lexical form (nothing exists on disk).
        let home = Path::new("/home/someone");
        let root = sessions_root_from(Some("/home/someone/x/../.codex".into()), None).unwrap();
        assert_eq!(display_path_for(&root, Some(home), false), "~/.codex/sessions");
        let up = sessions_root_from(Some("/home/someone/../someone/.codex".into()), None).unwrap();
        assert_eq!(display_path_for(&up, Some(home), false), "~/.codex/sessions");

        // Canonical form (real folders, home reached through `..`).
        let base = temp_base();
        let real_home = base.join("home");
        fs::create_dir_all(real_home.join("x")).unwrap();
        fs::create_dir_all(real_home.join(".codex").join("sessions")).unwrap();
        let root = sessions_root_from(Some(real_home.join("x").join("..").join(".codex").into()), None).unwrap();
        let shown = display_path_for(&root, Some(&real_home), CASE_INSENSITIVE_PATHS);
        assert_eq!(shown, "~/.codex/sessions");
        assert!(!shown.contains(real_home.to_str().unwrap()));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn display_path_ignores_case_where_the_file_system_does() {
        let home = Path::new("/Users/Someone");
        let root = Path::new("/users/someone/.codex/sessions");
        assert_eq!(display_path_for(root, Some(home), true), "~/.codex/sessions");
        assert_eq!(
            display_path_for(root, Some(home), false),
            "/users/someone/.codex/sessions"
        );
        assert_eq!(
            strip_home(Path::new("/USERS/SOMEONE/a"), home, true),
            Some(vec!["a".to_string()])
        );
    }

    #[test]
    fn instruction_messages_are_skipped_in_old_and_new_formats() {
        for text in [
            "<environment_context>x</environment_context>",
            "<user_instructions>x</user_instructions>",
            "# AGENTS.md instructions for /repo",
            "\n <INSTRUCTIONS>x</INSTRUCTIONS>",
        ] {
            let line = json!({"type":"message","role":"user","content":[{"type":"input_text","text":text}]});
            assert!(message_of(&line.to_string()).is_none(), "{text}");
        }
        let kept = json!({"type":"message","role":"user","content":[{"type":"input_text","text":"About # AGENTS.md instructions"}]});
        assert!(message_of(&kept.to_string()).is_some());
    }

    #[test]
    fn walk_skips_names_read_would_refuse() {
        let fx = fixture();
        let root = fx.root.clone();
        let day = root.join("2026").join("10").join("01");
        fs::write(day.join("rollout-.jsonl"), FIXTURE).unwrap();
        fs::write(day.join("rollout-c.json"), FIXTURE).unwrap();
        #[cfg(unix)]
        {
            fs::write(day.join("rollout-b\\x.jsonl"), FIXTURE).unwrap();
            fs::write(day.join("rollout-c:x.jsonl"), FIXTURE).unwrap();
            fs::create_dir_all(root.join("we:ird")).unwrap();
            fs::write(root.join("we:ird").join("rollout-d.jsonl"), FIXTURE).unwrap();
        }
        assert_eq!(detect(&root)["threadCount"], json!(1));
        let items = list(&root, None, DEFAULT_LIST_LIMIT);
        assert_eq!(items.len(), 1);
        for item in &items {
            assert!(read(&root, item["id"].as_str().unwrap(), READ_MAX_CHARS).is_ok());
        }
    }

    #[test]
    fn sessions_root_honours_codex_home() {
        assert_eq!(
            sessions_root_from(Some("/opt/codex".into()), Some("/home/someone".into())),
            Some(PathBuf::from("/opt/codex").join("sessions"))
        );
        assert_eq!(
            sessions_root_from(Some("".into()), Some("/home/someone".into())),
            Some(PathBuf::from("/home/someone").join(".codex").join("sessions"))
        );
        assert_eq!(sessions_root_from(None, None), None);
    }

    #[test]
    fn list_titles_from_first_real_user_message() {
        let fx = fixture();
        let root = fx.root.clone();
        let items = list(&root, None, DEFAULT_LIST_LIMIT);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], json!("2026/10/01/rollout-a.jsonl"));
        assert_eq!(items[0]["title"], json!("Plan the launch for Friday"));
        assert!(items[0]["updatedAt"].as_u64().unwrap() > 0);
        let updated = items[0]["updatedAt"].as_u64().unwrap();
        let after = |ms: u64| Some(After { ms, id: None });
        assert!(list(&root, after(updated), DEFAULT_LIST_LIMIT).is_empty());
        assert_eq!(list(&root, after(updated - 1), DEFAULT_LIST_LIMIT).len(), 1);
        assert!(list(&root, None, 0).is_empty());
    }

    #[test]
    fn list_title_is_capped_at_80_chars() {
        let fx = fixture();
        let root = fx.root.clone();
        let long = "x".repeat(200);
        let line = json!({"type":"message","role":"user","content":[{"type":"input_text","text":long}]});
        fs::write(root.join("rollout-long.jsonl"), format!("{line}\n")).unwrap();
        let items = list(&root, None, DEFAULT_LIST_LIMIT);
        let long_item = items.iter().find(|v| v["id"] == json!("rollout-long.jsonl")).unwrap();
        assert_eq!(long_item["title"].as_str().unwrap().chars().count(), 80);
    }

    #[test]
    fn read_formats_roles_and_truncates() {
        let fx = fixture();
        let root = fx.root.clone();
        let v = read(&root, "2026/10/01/rollout-a.jsonl", READ_MAX_CHARS).unwrap();
        assert_eq!(v["id"], json!("2026/10/01/rollout-a.jsonl"));
        assert_eq!(v["title"], json!("Plan the launch for Friday"));
        assert_eq!(
            v["text"],
            json!("user: Plan the launch for Friday\nassistant: Here is a plan. Step one.")
        );
        assert_eq!(v["truncated"], json!(false));
        let short = read(&root, "2026/10/01/rollout-a.jsonl", 10).unwrap();
        assert_eq!(short["text"], json!("user: Plan"));
        assert_eq!(short["truncated"], json!(true));
    }

    #[test]
    fn read_rejects_parent_and_absolute_ids() {
        let fx = fixture();
        let root = fx.root.clone();
        fs::write(root.parent().unwrap().join("x.jsonl"), FIXTURE).unwrap();
        fs::write(root.parent().unwrap().join("rollout-x.jsonl"), FIXTURE).unwrap();
        for bad in [
            "../x.jsonl",
            "../rollout-x.jsonl",
            "2026/../../rollout-x.jsonl",
            "/etc/passwd",
            "a.txt",
            "2026/10/01/notes.txt",
            "",
            "2026//10/01/rollout-a.jsonl",
            "./2026/10/01/rollout-a.jsonl",
            "2026\\10\\01\\rollout-a.jsonl",
            "2026/10/01/rollout-missing.jsonl",
        ] {
            let err = read(&root, bad, READ_MAX_CHARS).unwrap_err();
            assert!(!err.contains('/'), "error must not leak paths: {err}");
        }
        let abs = root.join("2026/10/01/rollout-a.jsonl");
        assert!(read(&root, abs.to_str().unwrap(), READ_MAX_CHARS).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn read_rejects_symlink_escaping_root() {
        let fx = fixture();
        let root = fx.root.clone();
        let outside = root.parent().unwrap().join("secret.jsonl");
        fs::write(&outside, FIXTURE).unwrap();
        std::os::unix::fs::symlink(&outside, root.join("rollout-escape.jsonl")).unwrap();
        std::os::unix::fs::symlink(root.parent().unwrap(), root.join("2026").join("up")).unwrap();
        fs::write(root.parent().unwrap().join("rollout-up.jsonl"), FIXTURE).unwrap();
        assert!(read(&root, "rollout-escape.jsonl", READ_MAX_CHARS).is_err());
        assert!(read(&root, "2026/up/rollout-up.jsonl", READ_MAX_CHARS).is_err());
        // Listing and counting never follow symlinks either.
        assert_eq!(detect(&root)["threadCount"], json!(1));
        assert_eq!(list(&root, None, DEFAULT_LIST_LIMIT).len(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn read_rejects_symlink_into_a_prefix_sibling() {
        // `sessions-evil` shares the string prefix `sessions` but is outside the root.
        let fx = fixture();
        let root = fx.root.clone();
        let evil = fx.base.join("sessions-evil");
        fs::create_dir_all(&evil).unwrap();
        fs::write(evil.join("rollout-e.jsonl"), FIXTURE).unwrap();
        std::os::unix::fs::symlink(evil.join("rollout-e.jsonl"), root.join("rollout-evil.jsonl")).unwrap();
        std::os::unix::fs::symlink(&evil, root.join("evil")).unwrap();
        assert!(read(&root, "rollout-evil.jsonl", READ_MAX_CHARS).is_err());
        assert!(read(&root, "evil/rollout-e.jsonl", READ_MAX_CHARS).is_err());
        assert_eq!(detect(&root)["threadCount"], json!(1));
    }

    #[cfg(unix)]
    #[test]
    fn open_checked_rejects_a_swapped_file() {
        let fx = fixture();
        let path = fx.root.join("2026").join("10").join("01").join("rollout-a.jsonl");
        let checked = fs::symlink_metadata(&path).unwrap();
        assert!(open_checked(&path, &checked).is_some());
        // Created before the removal so it cannot reuse the original inode.
        fs::write(fx.base.join("other.jsonl"), FIXTURE).unwrap();
        fs::remove_file(&path).unwrap();
        std::os::unix::fs::symlink(fx.base.join("other.jsonl"), &path).unwrap();
        assert!(open_checked(&path, &checked).is_none());
    }

    fn set_mtime(path: &Path, ms: u64) {
        let file = File::options().write(true).open(path).unwrap();
        file.set_modified(UNIX_EPOCH + std::time::Duration::from_millis(ms))
            .unwrap();
    }

    /// Pages through `list` the way the renderer does: after the last listed `(updatedAt, id)`.
    fn page_all(root: &Path, limit: usize) -> Vec<Vec<(u64, String)>> {
        let mut pages = Vec::new();
        let mut last: Option<(u64, String)> = None;
        loop {
            let after = last.as_ref().map(|(ms, id)| After {
                ms: *ms,
                id: Some(id.as_str()),
            });
            let page: Vec<(u64, String)> = list(root, after, limit)
                .iter()
                .map(|v| (v["updatedAt"].as_u64().unwrap(), v["id"].as_str().unwrap().to_string()))
                .collect();
            if page.is_empty() {
                return pages;
            }
            last = page.last().cloned();
            pages.push(page);
            assert!(pages.len() < 100, "paging never ends");
        }
    }

    #[test]
    fn list_pages_oldest_first_with_tied_times_without_gaps_or_duplicates() {
        let base = temp_base();
        let root = base.join("sessions");
        let day = root.join("2026").join("10").join("01");
        fs::create_dir_all(&day).unwrap();
        let mut expected = Vec::new();
        for i in 0..450u64 {
            let name = format!("rollout-{i:03}.jsonl");
            fs::write(day.join(&name), FIXTURE).unwrap();
            // Seven threads share each time; ids sort within a time.
            let ms = 1_700_000_000_000 + (i / 7) * 1000;
            set_mtime(&day.join(&name), ms);
            expected.push((ms, format!("2026/10/01/{name}")));
        }
        expected.sort();

        let pages = page_all(&root, 40);
        assert_eq!(pages.len(), 12);
        assert!(pages.iter().all(|p| p.len() <= 40));
        let seen: Vec<(u64, String)> = pages.concat();
        assert_eq!(seen, expected);

        // A page boundary inside a tie: the next page starts right after the last id at that time.
        let first = list(&root, None, 3);
        let first_ids: Vec<&str> = first.iter().map(|v| v["id"].as_str().unwrap()).collect();
        assert_eq!(
            first_ids,
            [
                "2026/10/01/rollout-000.jsonl",
                "2026/10/01/rollout-001.jsonl",
                "2026/10/01/rollout-002.jsonl"
            ]
        );
        let next = list(
            &root,
            Some(After {
                ms: 1_700_000_000_000,
                id: Some("2026/10/01/rollout-002.jsonl"),
            }),
            2,
        );
        assert_eq!(next[0]["id"], json!("2026/10/01/rollout-003.jsonl"));
        // Without an id, every thread at that time is behind the cursor.
        let after_time = list(
            &root,
            Some(After {
                ms: 1_700_000_000_000,
                id: None,
            }),
            1,
        );
        assert_eq!(after_time[0]["id"], json!("2026/10/01/rollout-007.jsonl"));

        // A thread written after the cursor has a newer time and is listed again.
        let (last_ms, last_id) = seen.last().cloned().unwrap();
        let again = day.join("rollout-010.jsonl");
        set_mtime(&again, last_ms + 5_000);
        let later = list(
            &root,
            Some(After {
                ms: last_ms,
                id: Some(&last_id),
            }),
            40,
        );
        assert_eq!(later.len(), 1);
        assert_eq!(later[0]["id"], json!("2026/10/01/rollout-010.jsonl"));
        let _ = fs::remove_dir_all(&base);
    }

    #[test]
    fn dispatch_list_takes_since_id_and_limit() {
        let fx = fixture();
        let root = fx.root.clone();
        let day = root.join("2026").join("10").join("01");
        fs::write(day.join("rollout-b.jsonl"), FIXTURE).unwrap();
        set_mtime(&day.join("rollout-a.jsonl"), 5_000);
        set_mtime(&day.join("rollout-b.jsonl"), 5_000);
        let all = dispatch(Some(&root), Some(&json!({ "op": "list", "limit": 1 }))).unwrap();
        assert_eq!(
            all,
            json!([{ "id": "2026/10/01/rollout-a.jsonl", "title": "Plan the launch for Friday", "updatedAt": 5000 }])
        );
        let next = dispatch(
            Some(&root),
            Some(&json!({ "op": "list", "sinceMs": 5000, "sinceId": "2026/10/01/rollout-a.jsonl" })),
        )
        .unwrap();
        assert_eq!(next[0]["id"], json!("2026/10/01/rollout-b.jsonl"));
        assert_eq!(next.as_array().unwrap().len(), 1);
        // A bad sinceId is ignored (as if absent), never an error.
        let odd = dispatch(
            Some(&root),
            Some(&json!({ "op": "list", "sinceMs": 4999, "sinceId": 7 })),
        )
        .unwrap();
        assert_eq!(odd.as_array().unwrap().len(), 2);
    }

    #[test]
    fn same_created_survives_an_append() {
        let fx = fixture();
        let path = fx.root.join("2026").join("10").join("01").join("rollout-a.jsonl");
        let before = fs::symlink_metadata(&path).unwrap();
        let mut file = File::options().append(true).open(&path).unwrap();
        std::io::Write::write_all(&mut file, b"more\n").unwrap();
        let after = file.metadata().unwrap();
        assert_ne!(before.len(), after.len());
        assert!(same_created(&before, &after));
    }

    #[test]
    fn slash_path_joins_components_with_forward_slashes() {
        assert_eq!(slash_path(Path::new("/opt/codex/sessions")), "/opt/codex/sessions");
        assert_eq!(slash_path(Path::new("codex/sessions")), "codex/sessions");
        assert_eq!(slash_path(Path::new("/")), "/");
    }

    #[test]
    fn dispatch_never_panics_on_bad_input() {
        let fx = fixture();
        let root = fx.root.clone();
        for bad in [
            json!(null),
            json!("detect"),
            json!({}),
            json!({ "op": 3 }),
            json!({ "op": "nope" }),
            json!({ "op": "read" }),
            json!({ "op": "read", "id": 7 }),
        ] {
            assert!(dispatch(Some(&root), Some(&bad)).is_err(), "{bad}");
        }
        assert!(dispatch(Some(&root), None).is_err());
        let listed = dispatch(Some(&root), Some(&json!({ "op": "list", "sinceMs": -5, "limit": "x" }))).unwrap();
        assert_eq!(listed.as_array().unwrap().len(), 1);
        let detected = dispatch(None, Some(&json!({ "op": "detect" }))).unwrap();
        assert_eq!(detected["found"], json!(false));
        assert_eq!(dispatch(None, Some(&json!({ "op": "list" }))).unwrap(), json!([]));
        assert!(dispatch(None, Some(&json!({ "op": "read", "id": "rollout-a.jsonl" }))).is_err());
    }
}

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

/// Path for display: the home directory becomes `~`, separators become `/`.
fn display_path_for(root: &Path, home: Option<&Path>) -> String {
    if let Some(home) = home {
        if let Ok(rest) = root.strip_prefix(home) {
            let parts: Vec<String> = rest
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect();
            return if parts.is_empty() {
                "~".to_string()
            } else {
                format!("~/{}", parts.join("/"))
            };
        }
    }
    root.display().to_string()
}

fn display_path(root: &Path) -> String {
    let home = home_dir_os().map(PathBuf::from);
    display_path_for(root, home.as_deref())
}

fn is_rollout_name(name: &str) -> bool {
    name.len() > "rollout-.jsonl".len() && name.starts_with("rollout-") && name.ends_with(".jsonl")
}

struct Entry {
    id: String,
    path: PathBuf,
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
            if kind.is_dir() {
                if rel.len() < MAX_WALK_DEPTH {
                    let mut child = rel.clone();
                    child.push(name);
                    stack.push((entry.path(), child));
                }
            } else if kind.is_file() && is_rollout_name(&name) {
                let mut parts = rel.clone();
                parts.push(name);
                visit(&entry.path(), &parts, &entry);
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
        let updated_at = entry.metadata().map(|m| mtime_ms(&m)).unwrap_or(0);
        out.push(Entry {
            id: parts.join("/"),
            path: path.to_path_buf(),
            updated_at,
        });
    });
    out
}

/// `{ id, title, updatedAt }`, newest first, only threads updated after `since_ms`.
pub fn list(root: &Path, since_ms: Option<u64>, limit: usize) -> Vec<Value> {
    let limit = limit.min(MAX_LIST_LIMIT);
    if limit == 0 || !root.is_dir() {
        return Vec::new();
    }
    let mut entries: Vec<Entry> = collect(root)
        .into_iter()
        .filter(|e| since_ms.is_none_or(|since| e.updated_at > since))
        .collect();
    entries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.id.cmp(&b.id)));
    entries.truncate(limit);
    entries
        .into_iter()
        .map(|e| {
            let title = File::open(&e.path)
                .map(|f| scan(f, TITLE_SCAN_BYTES, 0).title)
                .unwrap_or_default();
            json!({ "id": e.id, "title": title, "updatedAt": e.updated_at })
        })
        .collect()
}

/// Validates a renderer-supplied id and resolves it to a canonical file inside the root.
fn resolve(root: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.len() > MAX_ID_LEN || id.contains('\\') || id.contains('\0') || id.contains(':') {
        return Err(NOT_FOUND.into());
    }
    let parts: Vec<&str> = id.split('/').collect();
    if parts.iter().any(|p| p.is_empty() || *p == "." || *p == "..") {
        return Err(NOT_FOUND.into());
    }
    let rel = Path::new(id);
    if rel.is_absolute() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(NOT_FOUND.into());
    }
    if !parts.last().is_some_and(|name| is_rollout_name(name)) {
        return Err(NOT_FOUND.into());
    }
    let canon_root = fs::canonicalize(root).map_err(|_| NOT_FOUND.to_string())?;
    let canon = fs::canonicalize(canon_root.join(rel)).map_err(|_| NOT_FOUND.to_string())?;
    if !canon.starts_with(&canon_root) || canon == canon_root {
        return Err(NOT_FOUND.into());
    }
    let resolved_name_ok = canon.file_name().and_then(|n| n.to_str()).is_some_and(is_rollout_name);
    if !resolved_name_ok || !canon.is_file() {
        return Err(NOT_FOUND.into());
    }
    Ok(canon)
}

/// `{ id, title, updatedAt, text, truncated }`, text capped at `max_chars` characters.
pub fn read(root: &Path, id: &str, max_chars: usize) -> Result<Value, String> {
    let path = resolve(root, id)?;
    let file = File::open(&path).map_err(|_| NOT_FOUND.to_string())?;
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
        .filter(|text| {
            let t = text.trim_start();
            !t.starts_with("<environment_context>") && !t.starts_with("<user_instructions>")
        })
        .map(|text| text.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|text| !text.is_empty())
        .collect();
    if parts.is_empty() {
        return None;
    }
    Some((role, parts.join(" ")))
}

fn since_of(request: &Value) -> Option<u64> {
    let raw = request.get("sinceMs")?;
    if let Some(n) = raw.as_u64() {
        return Some(n);
    }
    raw.as_f64().filter(|f| f.is_finite() && *f >= 0.0).map(|f| f as u64)
}

/// `codex:threads` request: `{ op: 'detect' } | { op: 'list', sinceMs?, limit? } | { op: 'read', id }`.
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
            let items = root
                .map(|root| list(root, since_of(request), limit))
                .unwrap_or_default();
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
        r#"{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Plan the launch\nfor Friday"}]}}"#,
        "\n",
        "not json at all\n",
        r#"{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Here is a plan."},{"type":"output_text","text":"Step one."}]}}"#,
        "\n",
    );

    fn fixture() -> PathBuf {
        let n = SEQ.fetch_add(1, Ordering::SeqCst);
        let base = std::env::temp_dir().join(format!("dango-codex-{}-{n}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let root = base.join("sessions");
        let day = root.join("2026").join("10").join("01");
        fs::create_dir_all(&day).unwrap();
        fs::write(day.join("rollout-a.jsonl"), FIXTURE).unwrap();
        fs::write(day.join("notes.txt"), "not a thread").unwrap();
        root
    }

    #[test]
    fn detect_counts_without_reading() {
        let root = fixture();
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
            display_path_for(Path::new("/home/someone/.codex/sessions"), Some(home)),
            "~/.codex/sessions"
        );
        assert_eq!(
            display_path_for(Path::new("/opt/codex/sessions"), Some(home)),
            "/opt/codex/sessions"
        );
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
        let root = fixture();
        let items = list(&root, None, DEFAULT_LIST_LIMIT);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0]["id"], json!("2026/10/01/rollout-a.jsonl"));
        assert_eq!(items[0]["title"], json!("Plan the launch for Friday"));
        assert!(items[0]["updatedAt"].as_u64().unwrap() > 0);
        let updated = items[0]["updatedAt"].as_u64().unwrap();
        assert!(list(&root, Some(updated), DEFAULT_LIST_LIMIT).is_empty());
        assert_eq!(list(&root, Some(updated - 1), DEFAULT_LIST_LIMIT).len(), 1);
        assert!(list(&root, None, 0).is_empty());
    }

    #[test]
    fn list_title_is_capped_at_80_chars() {
        let root = fixture();
        let long = "x".repeat(200);
        let line = json!({"type":"message","role":"user","content":[{"type":"input_text","text":long}]});
        fs::write(root.join("rollout-long.jsonl"), format!("{line}\n")).unwrap();
        let items = list(&root, None, DEFAULT_LIST_LIMIT);
        let long_item = items.iter().find(|v| v["id"] == json!("rollout-long.jsonl")).unwrap();
        assert_eq!(long_item["title"].as_str().unwrap().chars().count(), 80);
    }

    #[test]
    fn read_formats_roles_and_truncates() {
        let root = fixture();
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
        let root = fixture();
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
        let root = fixture();
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

    #[test]
    fn dispatch_never_panics_on_bad_input() {
        let root = fixture();
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

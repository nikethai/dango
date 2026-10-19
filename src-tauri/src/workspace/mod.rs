//! Native project workspace authority: picker-owned bindings, capabilities, and handle-relative ops.

mod apply_journal;
mod authority;
mod budgets;
mod change_set;
mod codex_threads;
mod error;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod export;
mod git_porcelain;
mod global_roots;
mod ignore;
mod lease;
mod local_execution;
mod path;
mod policy;
#[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
mod source_control;
mod suite_state;
mod traverse;
mod worktree_gate;

pub use global_roots::is_native_known_global_root;

#[cfg(test)]
mod tests;
#[cfg(test)]
mod suite_tests;

pub use authority::WorkspaceRuntime;
pub use error::WorkspaceError;

use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewWindow};

type CommandResult<T> = Result<T, String>;

fn arg_str(args: &[Value], idx: usize) -> Result<String, String> {
    args.get(idx)
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .ok_or_else(|| format!("workspace: missing string argument {idx}"))
}

fn arg_obj(args: &[Value], idx: usize) -> Result<&Value, String> {
    args.get(idx).ok_or_else(|| format!("workspace: missing argument {idx}"))
}

fn wrap(result: Result<Value, WorkspaceError>) -> CommandResult<Value> {
    match result {
        Ok(value) => Ok(error::envelope_ok(value)),
        Err(err) => Ok(err.to_envelope()),
    }
}

fn window_label(window: &WebviewWindow) -> String {
    window.label().to_string()
}

/// Dispatch workspace:* plus narrow brokers. Returns None for unrelated channels.
pub fn handle(
    app: &AppHandle,
    window: &WebviewWindow,
    runtime: &WorkspaceRuntime,
    channel: &str,
    args: &[Value],
) -> Option<CommandResult<Value>> {
    if channel == "workspace:authorize-path" || channel == "workspace:bind-path" {
        return Some(Ok(error::unauthorized_root(
            "Directory authorization requires the native folder picker; renderer paths are rejected",
        )
        .to_envelope()));
    }

    if !channel.starts_with("workspace:")
        && !channel.starts_with("scm:")
        && !channel.starts_with("changes:")
        && !channel.starts_with("wasi:")
        && !channel.starts_with("worktrees:")
        && channel != "codex:read-auth-config"
        && channel != "codex:threads"
        && channel != "video:yt-dlp"
    {
        return None;
    }

    Some(handle_inner(app, window, runtime, channel, args))
}

fn handle_inner(
    app: &AppHandle,
    window: &WebviewWindow,
    runtime: &WorkspaceRuntime,
    channel: &str,
    args: &[Value],
) -> CommandResult<Value> {
    let label = window_label(window);

    match channel {
        "workspace:pick-and-bind" => {
            let project_id = arg_str(args, 0)?;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let folder = rfd::FileDialog::new()
                    .set_title("Open Project Folder")
                    .pick_folder();
                let Some(folder) = folder else {
                    return wrap(Ok(Value::Null));
                };
                wrap(runtime.bind_picker_result(&project_id, &label, &folder))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                let _ = project_id;
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Project folders are only available on desktop",
                )))
            }
        }
        "workspace:relink" => {
            let project_id = arg_str(args, 0)?;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                let folder = rfd::FileDialog::new()
                    .set_title("Locate Project Folder")
                    .pick_folder();
                let Some(folder) = folder else {
                    return wrap(Ok(Value::Null));
                };
                wrap(runtime.relink(&project_id, &label, &folder))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                let _ = project_id;
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Project folders are only available on desktop",
                )))
            }
        }
        "workspace:restore" => {
            let project_id = arg_str(args, 0)?;
            wrap(runtime.restore(&project_id, &label))
        }
        "workspace:revoke" => {
            let project_id = arg_str(args, 0)?;
            wrap(runtime.revoke_project(&project_id, &label).map(|_| Value::Null))
        }
        "workspace:unbind" => {
            let project_id = arg_str(args, 0)?;
            wrap(runtime.unbind(&project_id, &label).map(|_| Value::Null))
        }
        "workspace:adopt-draft-binding" => {
            let draft_id = arg_str(args, 0)?;
            let project_id = arg_str(args, 1)?;
            wrap(runtime.adopt_draft_binding(&draft_id, &project_id, &label))
        }
        "workspace:discard-draft-bindings" => {
            wrap(runtime.discard_draft_bindings(&label).map(|count| json!(count)))
        }
        "workspace:reveal" => {
            let project_id = arg_str(args, 0)?;
            match runtime.reveal_path(&project_id, &label) {
                Ok(path) => {
                    reveal_in_os(&path);
                    wrap(Ok(json!({ "ok": true })))
                }
                Err(err) => wrap(Err(err)),
            }
        }
        "workspace:read" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let rel = opts.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");
            wrap(runtime.read(cap, &label, rel))
        }
        "workspace:list" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let rel = opts.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");
            let cursor = opts.get("cursor").and_then(|v| v.as_str());
            let request_id = opts.get("requestId").and_then(|v| v.as_str());
            wrap(runtime.list(cap, &label, rel, cursor, request_id))
        }
        "workspace:search" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let query = opts.get("query").and_then(|v| v.as_str()).unwrap_or("");
            let request_id = opts.get("requestId").and_then(|v| v.as_str());
            wrap(runtime.search(cap, &label, query, request_id))
        }
        "workspace:cancel" => {
            let request_id = arg_str(args, 0)?;
            runtime.cancel_request(&request_id);
            wrap(Ok(Value::Null))
        }
        "workspace:create" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let rel = opts.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");
            let content = opts.get("content").and_then(|v| v.as_str()).unwrap_or("");
            let mode = opts.get("mode").and_then(|v| v.as_str()).unwrap_or("create");
            let expected = opts.get("expectedRevision").and_then(|v| v.as_str());
            wrap(runtime.create_file(cap, &label, rel, content, mode, expected))
        }
        "workspace:edit" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let rel = opts.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");
            let old = opts.get("oldString").and_then(|v| v.as_str()).unwrap_or("");
            let new = opts.get("newString").and_then(|v| v.as_str()).unwrap_or("");
            let expected = opts.get("expectedRevision").and_then(|v| v.as_str()).unwrap_or("");
            wrap(runtime.edit_file(cap, &label, rel, old, new, expected))
        }
        "workspace:delete" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let rel = opts.get("relativePath").and_then(|v| v.as_str()).unwrap_or("");
            let expected = opts.get("expectedRevision").and_then(|v| v.as_str()).unwrap_or("");
            wrap(runtime.delete_file(cap, &label, rel, expected))
        }
        "workspace:set-trust" => {
            let project_id = arg_str(args, 0)?;
            let category = arg_str(args, 1)?;
            let value = arg_str(args, 2)?;
            wrap(runtime.set_trust(&project_id, &label, &category, &value).map(|_| Value::Null))
        }
        "workspace:get-trust" => {
            let project_id = arg_str(args, 0)?;
            let value = match runtime.get_trust(&project_id) {
                Some(trust) => json!({
                    "files": trust.files,
                    "instructions": trust.instructions,
                    "skillsCommands": trust.skills_commands,
                    "hooks": trust.hooks,
                }),
                None => json!({
                    "files": "unset",
                    "instructions": "unset",
                    "skillsCommands": "unset",
                    "hooks": "unset",
                }),
            };
            wrap(Ok(value))
        }
        "workspace:set-mutation" => {
            if label != "main" {
                return wrap(Err(error::wrong_window()));
            }
            let enabled = args.first().and_then(|v| v.as_bool()).unwrap_or(false);
            // Renderer flags may only hide or revoke. Enabling is ignored.
            runtime.set_mutation_enabled(enabled);
            wrap(Ok(json!({ "mutationEnabled": runtime.mutation_enabled() })))
        }
        "workspace:capabilities" => wrap(Ok(runtime.suite_capabilities())),
        "workspace:prepare-export" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let selection = opts.get("selection").cloned().unwrap_or(json!({}));
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.prepare_workspace_export(cap, &label, &selection))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                let _ = (cap, selection);
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Project export is desktop-only",
                )))
            }
        }
        "workspace:prepare-artifact-export" => {
            let artifact_id = arg_str(args, 0)?;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.prepare_app_artifact_export(&artifact_id, &label))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Project export is desktop-only",
                )))
            }
        }
        "workspace:export" => {
            let manifest_id = arg_str(args, 0)?;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.export_workspace(&manifest_id, &label))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Project export is desktop-only",
                )))
            }
        }
        "workspace:discard-export" => {
            let manifest_id = arg_str(args, 0)?;
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.discard_workspace_export(&manifest_id))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Ok(json!({ "ok": true })))
            }
        }
        "scm:status" => {
            let cap = arg_str(args, 0).or_else(|_| {
                arg_obj(args, 0).map(|o| o.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("").to_string())
            })?;
            let cap = if cap.is_empty() {
                arg_obj(args, 0)?
                    .get("capabilityId")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string()
            } else {
                cap
            };
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.source_control_status(&cap, &label))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Source control is desktop-only",
                )))
            }
        }
        "scm:diff" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let change_id = opts.get("changeId").and_then(|v| v.as_str());
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.source_control_diff(cap, &label, change_id))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Source control is desktop-only",
                )))
            }
        }
        "scm:log" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let limit = opts.get("limit").and_then(|v| v.as_u64()).map(|n| n as usize);
            #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
            {
                wrap(runtime.source_control_log(cap, &label, limit))
            }
            #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
            {
                wrap(Err(error::WorkspaceError::new(
                    error::UNSUPPORTED_PLATFORM,
                    "Source control is desktop-only",
                )))
            }
        }
        "changes:begin" => {
            let opts = arg_obj(args, 0)?;
            let cap = opts.get("capabilityId").and_then(|v| v.as_str()).unwrap_or("");
            let session = opts.get("sessionId").and_then(|v| v.as_str()).unwrap_or("");
            let turn = opts.get("turnId").and_then(|v| v.as_str()).unwrap_or("");
            wrap(runtime.begin_change_set(cap, &label, session, turn))
        }
        "changes:append" => {
            let opts = arg_obj(args, 0)?;
            let id = opts.get("changeSetId").and_then(|v| v.as_str()).unwrap_or("");
            let op = opts.get("operation").cloned().unwrap_or(json!({}));
            wrap(runtime.append_change(id, &label, &op))
        }
        "changes:seal" => wrap(runtime.seal_change_set(&arg_str(args, 0)?, &label)),
        "changes:get" => wrap(runtime.get_change_set(&arg_str(args, 0)?, &label)),
        "changes:discard" => wrap(runtime.discard_change_set(&arg_str(args, 0)?, &label)),
        "changes:preflight" => {
            let opts = arg_obj(args, 0)?;
            let id = opts.get("changeSetId").and_then(|v| v.as_str()).unwrap_or("");
            let digest = opts.get("digest").and_then(|v| v.as_str()).unwrap_or("");
            let selected: Vec<String> = opts
                .get("selectedIds")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            wrap(runtime.preflight_change_set(id, &label, digest, &selected))
        }
        "changes:prepare-apply" => {
            let opts = arg_obj(args, 0)?;
            let id = opts.get("changeSetId").and_then(|v| v.as_str()).unwrap_or("");
            let digest = opts.get("digest").and_then(|v| v.as_str()).unwrap_or("");
            let selected: Vec<String> = opts
                .get("selectedIds")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
                .unwrap_or_default();
            wrap(runtime.prepare_apply(id, &label, digest, &selected))
        }
        "changes:apply" => wrap(runtime.apply_change_set(&arg_str(args, 0)?, &label)),
        "wasi:status" => wrap(Ok(local_execution::status())),
        "wasi:prepare" | "wasi:run" => wrap(Err(local_execution::reject_run())),
        "worktrees:status" => wrap(Ok(worktree_gate::status())),
        "worktrees:create" | "worktrees:remove" => wrap(Err(error::feature_disabled("worktrees"))),
        "codex:read-auth-config" => read_codex_auth(),
        "codex:threads" => {
            if let Err(err) = WorkspaceRuntime::require_main(&label) {
                return wrap(Err(err));
            }
            let root = codex_threads::sessions_root();
            wrap(
                codex_threads::dispatch(root.as_deref(), args.first())
                    .map_err(|message| error::WorkspaceError::new(error::NOT_FOUND, message)),
            )
        }
        "video:yt-dlp" => video_yt_dlp(args),
        _ => {
            let _ = app;
            Err(format!("unknown workspace channel: {channel}"))
        }
    }
}

fn reveal_in_os(path: &str) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(path).spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer").arg(path).spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(path).spawn();
    }
}

fn read_codex_auth() -> CommandResult<Value> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| "HOME is not set".to_string())?;
    let path = PathBuf::from(home).join(".codex").join("auth.json");
    let content = std::fs::read_to_string(&path)
        .map_err(|err| format!("failed to read Codex auth.json: {err}"))?;
    Ok(Value::String(content))
}

fn video_yt_dlp(args: &[Value]) -> CommandResult<Value> {
    let op = arg_str(args, 0)?;
    match op.as_str() {
        "detect" => {
            let output = std::process::Command::new("yt-dlp")
                .arg("--version")
                .output();
            match output {
                Ok(out) if out.status.success() => {
                    let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    Ok(json!({ "installed": true, "version": version, "installer": "path" }))
                }
                _ => Ok(json!({ "installed": false, "installer": "none" })),
            }
        }
        "install" => {
            #[cfg(target_os = "macos")]
            {
                let output = std::process::Command::new("brew")
                    .args(["install", "yt-dlp"])
                    .output()
                    .map_err(|err| format!("brew failed: {err}"))?;
                let log = format!(
                    "{}{}",
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                );
                return Ok(json!({ "ok": output.status.success(), "log": log }));
            }
            #[cfg(not(target_os = "macos"))]
            {
                Ok(json!({ "ok": false, "log": "", "error": "Use the OS package manager to install yt-dlp." }))
            }
        }
        _ => Err("video:yt-dlp unknown operation".into()),
    }
}

pub fn open_desktop(app: &AppHandle, runtime: &WorkspaceRuntime) {
    if let Ok(dir) = app.path().app_data_dir() {
        let _ = runtime.open_desktop(&dir);
        // Mutation stays off until the main window enables it from the product flag.
        runtime.set_mutation_enabled(false);
    }
}

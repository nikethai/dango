//! Private binding registry, runtime capabilities, and privileged operations.

use super::budgets::{
    LIST_PAGE_SIZE, MUTATION_MAX_BYTES, READ_MAX_BYTES, SEARCH_DEADLINE_MS, SEARCH_MAX_DEPTH, SEARCH_MAX_ENTRIES,
    SEARCH_MAX_FILE_BYTES, SEARCH_MAX_HITS, SEARCH_MAX_INSPECTED_BYTES,
};
use super::error::{
    already_exists, ambiguous_edit, cancelled, conflict, hard_denied, limit_exceeded, mutation_disabled, not_found,
    revoked, stale_capability, unauthorized_root, wrong_window, WorkspaceError, ALREADY_EXISTS, PERMISSION_DENIED,
};
use super::ignore::{gitignore_path, is_hard_denied, IgnoreStack};
use super::lease::{LeaseBook, OpGuard};
use super::path::{content_revision, RelativePath};
use super::policy::NativeRollout;
use super::suite_state::SuiteState;
use super::traverse::{
    create_new_exclusive, delete_file, exists_nofollow, filesystem_identity, list_children, read_file_bytes,
    read_file_limited, write_atomic,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

const MAIN_WINDOW: &str = "main";
/// Binding ids minted for a picked folder before its scope exists (Add a source sheet).
const DRAFT_PREFIX: &str = "draft:";
/// Exact text; the renderer maps it to `SourceRuleError('folder-taken')`.
const SCOPE_HAS_FOLDER: &str = "This scope already has a folder.";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustState {
    pub files: String,
    pub instructions: String,
    pub skills_commands: String,
    pub hooks: String,
}

impl Default for TrustState {
    fn default() -> Self {
        Self {
            files: "unset".into(),
            instructions: "unset".into(),
            skills_commands: "unset".into(),
            hooks: "unset".into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectBinding {
    pub project_id: String,
    pub display_path: String,
    pub filesystem_identity: String,
    pub root_generation: String,
    pub status: String,
    pub last_opened_at: i64,
    pub trust: TrustState,
    pub checksum: String,
}

impl ProjectBinding {
    fn compute_checksum(project_id: &str, display_path: &str, identity: &str, generation: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(project_id.as_bytes());
        hasher.update(display_path.as_bytes());
        hasher.update(identity.as_bytes());
        hasher.update(generation.as_bytes());
        hasher.finalize().iter().map(|b| format!("{b:02x}")).collect()
    }

    fn with_checksum(mut self) -> Self {
        self.checksum = Self::compute_checksum(
            &self.project_id,
            &self.display_path,
            &self.filesystem_identity,
            &self.root_generation,
        );
        self
    }

    fn verify(&self) -> bool {
        self.checksum
            == Self::compute_checksum(
                &self.project_id,
                &self.display_path,
                &self.filesystem_identity,
                &self.root_generation,
            )
    }
}

#[derive(Debug, Clone)]
struct RuntimeCapability {
    id: String,
    project_id: String,
    window_label: String,
    root_generation: String,
    root_path: PathBuf,
    revoked: bool,
    cancel_epoch: u64,
}

struct Inner {
    registry_path: PathBuf,
    private_root: PathBuf,
    bindings: HashMap<String, ProjectBinding>,
    capabilities: HashMap<String, RuntimeCapability>,
    leases: LeaseBook,
}

pub struct WorkspaceRuntime {
    inner: Mutex<Inner>,
    mutation_enabled: AtomicBool,
    rollout: Mutex<NativeRollout>,
    pub(crate) suite: Mutex<SuiteState>,
    #[cfg(test)]
    revoke_before_commit: AtomicBool,
}

impl Default for WorkspaceRuntime {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                registry_path: PathBuf::from("project-bindings.json"),
                private_root: PathBuf::from("workspace-suite"),
                bindings: HashMap::new(),
                capabilities: HashMap::new(),
                leases: LeaseBook::default(),
            }),
            mutation_enabled: AtomicBool::new(false),
            rollout: Mutex::new(NativeRollout::compiled()),
            suite: Mutex::new(SuiteState::default()),
            #[cfg(test)]
            revoke_before_commit: AtomicBool::new(false),
        }
    }
}

impl WorkspaceRuntime {
    #[cfg(test)]
    pub fn for_tests(registry_path: PathBuf, mutation_enabled: bool) -> Self {
        let rt = Self::default();
        if let Ok(mut inner) = rt.inner.lock() {
            inner.registry_path = registry_path.clone();
            if let Some(parent) = registry_path.parent() {
                inner.private_root = parent.join("workspace-suite");
                let _ = fs::create_dir_all(&inner.private_root);
            }
        }
        rt.mutation_enabled.store(mutation_enabled, Ordering::SeqCst);
        if let Ok(mut rollout) = rt.rollout.lock() {
            *rollout = NativeRollout::for_tests_with_mutation(mutation_enabled);
        }
        if let Ok(mut suite) = rt.suite.lock() {
            if let Some(parent) = registry_path.parent() {
                *suite = SuiteState::new(parent.join("workspace-suite"));
            }
        }
        rt
    }

    pub fn rollout(&self) -> NativeRollout {
        self.rollout.lock().map(|g| *g).unwrap_or_else(|_| NativeRollout::compiled())
    }

    #[allow(dead_code)]
    pub fn set_rollout(&self, rollout: NativeRollout) {
        if let Ok(mut g) = self.rollout.lock() {
            *g = rollout;
        }
        self.mutation_enabled
            .store(rollout.direct_mutation, Ordering::SeqCst);
    }

    /// Renderer may only disable. Enabling is ignored.
    pub fn set_mutation_enabled(&self, enabled: bool) {
        if enabled {
            return;
        }
        self.mutation_enabled.store(false, Ordering::SeqCst);
        if let Ok(mut g) = self.rollout.lock() {
            g.direct_mutation = false;
        }
    }

    #[cfg(test)]
    #[allow(dead_code)]
    pub fn force_mutation_enabled_for_tests(&self, enabled: bool) {
        self.mutation_enabled.store(enabled, Ordering::SeqCst);
        if let Ok(mut g) = self.rollout.lock() {
            g.direct_mutation = enabled;
        }
    }

    #[cfg(test)]
    pub fn set_revoke_before_commit(&self, enabled: bool) {
        self.revoke_before_commit.store(enabled, Ordering::SeqCst);
    }

    pub fn private_root(&self) -> Result<PathBuf, WorkspaceError> {
        let inner = self.lock()?;
        Ok(inner.private_root.clone())
    }

    pub fn mutation_enabled(&self) -> bool {
        self.mutation_enabled.load(Ordering::SeqCst)
    }

    pub fn open_desktop(&self, dir: &Path) -> Result<(), WorkspaceError> {
        fs::create_dir_all(dir).map_err(|e| WorkspaceError::new(PERMISSION_DENIED, format!("{e}")))?;
        let path = dir.join("project-bindings.json");
        let private = dir.join("workspace-suite");
        fs::create_dir_all(&private).map_err(|e| WorkspaceError::new(PERMISSION_DENIED, format!("{e}")))?;
        let mut inner = self.lock()?;
        inner.registry_path = path.clone();
        inner.private_root = private.clone();
        drop(inner);
        if let Ok(mut suite) = self.suite.lock() {
            *suite = SuiteState::new(private);
        }
        let mut inner = self.lock()?;
        if let Ok(text) = fs::read_to_string(&path) {
            if let Ok(map) = serde_json::from_str::<HashMap<String, ProjectBinding>>(&text) {
                inner.bindings = map.into_iter().filter(|(_, b)| b.verify()).collect();
            }
        }
        Ok(())
    }

    pub(crate) fn lock(&self) -> Result<std::sync::MutexGuard<'_, Inner>, WorkspaceError> {
        self.inner
            .lock()
            .map_err(|_| WorkspaceError::new(PERMISSION_DENIED, "workspace lock poisoned"))
    }

    fn persist(inner: &Inner) {
        if let Ok(text) = serde_json::to_string_pretty(&inner.bindings) {
            let _ = fs::write(&inner.registry_path, text);
        }
    }

    pub(crate) fn now_ms() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    }

    pub(crate) fn require_main(window_label: &str) -> Result<(), WorkspaceError> {
        if window_label != MAIN_WINDOW {
            return Err(wrong_window());
        }
        Ok(())
    }

    /// Renderer-supplied path must never mint a binding. Tests call `bind_picker_result`.
    #[cfg(test)]
    pub fn reject_authorize_path(&self, _project_id: &str, _path: &str) -> Result<(), WorkspaceError> {
        Err(unauthorized_root(
            "Directory authorization requires the native folder picker; renderer paths are rejected",
        ))
    }

    /// Native picker (or test fixture) result — the only path that creates a binding.
    pub fn bind_picker_result(
        &self,
        project_id: &str,
        window_label: &str,
        root: &Path,
    ) -> Result<Value, WorkspaceError> {
        Self::require_main(window_label)?;
        if project_id.trim().is_empty() {
            return Err(unauthorized_root("projectId is required"));
        }
        let root = fs::canonicalize(root).map_err(|_| unauthorized_root("Selected folder is not accessible"))?;
        if !root.is_dir() {
            return Err(unauthorized_root("Selected path is not a directory"));
        }
        let identity = filesystem_identity(&root)?;
        let generation = Uuid::new_v4().to_string();
        let display = root.display().to_string();
        let binding = ProjectBinding {
            project_id: project_id.to_string(),
            display_path: display.clone(),
            filesystem_identity: identity,
            root_generation: generation.clone(),
            status: "ready".into(),
            last_opened_at: Self::now_ms(),
            trust: TrustState::default(),
            checksum: String::new(),
        }
        .with_checksum();

        let mut inner = self.lock()?;
        self.revoke_project_locked(&mut inner, project_id);
        inner.bindings.insert(project_id.to_string(), binding.clone());
        Self::persist(&inner);
        let cap = self.issue_capability_locked(&mut inner, project_id, window_label, &root, &generation)?;
        Ok(descriptor_json(
            project_id,
            &cap.id,
            &generation,
            &display,
            "ready",
            &binding.trust,
        ))
    }

    fn issue_capability_locked(
        &self,
        inner: &mut Inner,
        project_id: &str,
        window_label: &str,
        root: &Path,
        generation: &str,
    ) -> Result<RuntimeCapability, WorkspaceError> {
        if let Some(existing) = inner.capabilities.values().find(|cap| {
            !cap.revoked
                && cap.project_id == project_id
                && cap.window_label == window_label
                && cap.root_generation == generation
                && cap.root_path == root
        }) {
            return Ok(existing.clone());
        }
        let cap = RuntimeCapability {
            id: Uuid::new_v4().to_string(),
            project_id: project_id.to_string(),
            window_label: window_label.to_string(),
            root_generation: generation.to_string(),
            root_path: root.to_path_buf(),
            revoked: false,
            cancel_epoch: 0,
        };
        inner.capabilities.insert(cap.id.clone(), cap.clone());
        Ok(cap)
    }

    fn revoke_project_locked(&self, inner: &mut Inner, project_id: &str) {
        for cap in inner.capabilities.values_mut() {
            if cap.project_id == project_id {
                cap.revoked = true;
                cap.cancel_epoch += 1;
            }
        }
        inner.capabilities.retain(|_, cap| cap.project_id != project_id || !cap.revoked);
    }

    pub fn restore(&self, project_id: &str, window_label: &str) -> Result<Value, WorkspaceError> {
        Self::require_main(window_label)?;
        let mut inner = self.lock()?;
        let binding = inner
            .bindings
            .get(project_id)
            .cloned()
            .ok_or_else(|| unauthorized_root("No native binding exists for this project"))?;
        if !binding.verify() {
            return Err(unauthorized_root("Native binding record failed integrity check"));
        }
        let root = PathBuf::from(&binding.display_path);
        if !root.is_dir() {
            return Ok(descriptor_json(
                project_id,
                "",
                &binding.root_generation,
                &binding.display_path,
                "missing",
                &binding.trust,
            ));
        }
        let identity = filesystem_identity(&root).unwrap_or_default();
        if identity != binding.filesystem_identity {
            return Ok(descriptor_json(
                project_id,
                "",
                &binding.root_generation,
                &binding.display_path,
                "relink-required",
                &binding.trust,
            ));
        }
        let cap = self.issue_capability_locked(
            &mut inner,
            project_id,
            window_label,
            &root,
            &binding.root_generation,
        )?;
        Ok(descriptor_json(
            project_id,
            &cap.id,
            &binding.root_generation,
            &binding.display_path,
            "ready",
            &binding.trust,
        ))
    }

    pub fn relink(&self, project_id: &str, window_label: &str, root: &Path) -> Result<Value, WorkspaceError> {
        self.bind_picker_result(project_id, window_label, root)
    }

    pub fn unbind(&self, project_id: &str, window_label: &str) -> Result<(), WorkspaceError> {
        Self::require_main(window_label)?;
        let mut inner = self.lock()?;
        self.revoke_project_locked(&mut inner, project_id);
        inner.bindings.remove(project_id);
        Self::persist(&inner);
        drop(inner);
        self.wait_in_flight();
        Ok(())
    }

    /// Re-keys a picker-minted `draft:` binding to a scope. Never takes a path from the renderer.
    pub fn adopt_draft_binding(
        &self,
        draft_id: &str,
        project_id: &str,
        window_label: &str,
    ) -> Result<Value, WorkspaceError> {
        Self::require_main(window_label)?;
        if !draft_id.starts_with(DRAFT_PREFIX) || draft_id.len() == DRAFT_PREFIX.len() {
            return Err(unauthorized_root("Only a draft folder binding can be adopted"));
        }
        if project_id.trim().is_empty() || project_id.starts_with(DRAFT_PREFIX) {
            return Err(unauthorized_root("projectId is required"));
        }
        let mut inner = self.lock()?;
        let draft = inner
            .bindings
            .get(draft_id)
            .cloned()
            .ok_or_else(|| unauthorized_root("No draft folder binding exists"))?;
        if !draft.verify() {
            return Err(unauthorized_root("Native binding record failed integrity check"));
        }
        if inner.bindings.contains_key(project_id) {
            return Err(WorkspaceError::new(ALREADY_EXISTS, SCOPE_HAS_FOLDER));
        }
        let adopted = ProjectBinding {
            project_id: project_id.to_string(),
            last_opened_at: Self::now_ms(),
            ..draft
        }
        .with_checksum();
        self.revoke_project_locked(&mut inner, draft_id);
        self.revoke_project_locked(&mut inner, project_id);
        inner.bindings.remove(draft_id);
        inner.bindings.insert(project_id.to_string(), adopted);
        Self::persist(&inner);
        drop(inner);
        self.wait_in_flight();
        self.restore(project_id, window_label)
    }

    /// Removes every `draft:` binding (sheet cancelled, or leftovers at launch). Returns how many.
    pub fn discard_draft_bindings(&self, window_label: &str) -> Result<usize, WorkspaceError> {
        Self::require_main(window_label)?;
        let mut inner = self.lock()?;
        let drafts: Vec<String> = inner
            .bindings
            .keys()
            .filter(|id| id.starts_with(DRAFT_PREFIX))
            .cloned()
            .collect();
        for id in &drafts {
            self.revoke_project_locked(&mut inner, id);
            inner.bindings.remove(id);
        }
        if !drafts.is_empty() {
            Self::persist(&inner);
        }
        drop(inner);
        if !drafts.is_empty() {
            self.wait_in_flight();
        }
        Ok(drafts.len())
    }

    pub fn revoke_project(&self, project_id: &str, window_label: &str) -> Result<(), WorkspaceError> {
        Self::require_main(window_label)?;
        let mut inner = self.lock()?;
        self.revoke_project_locked(&mut inner, project_id);
        drop(inner);
        self.wait_in_flight();
        Ok(())
    }

    pub fn revoke_window(&self, window_label: &str) {
        if let Ok(mut inner) = self.lock() {
            for cap in inner.capabilities.values_mut() {
                if cap.window_label == window_label {
                    cap.revoked = true;
                    cap.cancel_epoch += 1;
                }
            }
            inner.capabilities.retain(|_, cap| cap.window_label != window_label);
        }
    }

    fn wait_in_flight(&self) {
        let start = std::time::Instant::now();
        while start.elapsed().as_millis() < 2_000 {
            let n = self
                .lock()
                .ok()
                .map(|inner| inner.leases.global.load(std::sync::atomic::Ordering::SeqCst))
                .unwrap_or(0);
            if n == 0 {
                break;
            }
            std::thread::yield_now();
        }
    }

    fn begin_op(&self, project_id: &str, request_id: Option<&str>) -> Result<OpGuard, WorkspaceError> {
        let mut inner = self.lock()?;
        inner.leases.begin(project_id, request_id)
    }

    pub(crate) fn lookup_cap(
        &self,
        capability_id: &str,
        window_label: &str,
    ) -> Result<(PathBuf, String, String, String), WorkspaceError> {
        let inner = self.lock()?;
        let cap = inner
            .capabilities
            .get(capability_id)
            .ok_or_else(stale_capability)?;
        if cap.revoked {
            return Err(revoked());
        }
        if cap.window_label != window_label {
            return Err(wrong_window());
        }
        if window_label != MAIN_WINDOW {
            return Err(wrong_window());
        }
        let binding = inner.bindings.get(&cap.project_id).ok_or_else(stale_capability)?;
        if binding.root_generation != cap.root_generation {
            return Err(stale_capability());
        }
        let identity = filesystem_identity(&cap.root_path).unwrap_or_default();
        if identity != binding.filesystem_identity {
            return Err(stale_capability());
        }
        Ok((
            cap.root_path.clone(),
            cap.project_id.clone(),
            cap.root_generation.clone(),
            identity,
        ))
    }

    pub fn set_trust(
        &self,
        project_id: &str,
        window_label: &str,
        category: &str,
        value: &str,
    ) -> Result<(), WorkspaceError> {
        Self::require_main(window_label)?;
        let mut inner = self.lock()?;
        let binding = inner
            .bindings
            .get_mut(project_id)
            .ok_or_else(|| unauthorized_root("No native binding exists for this project"))?;
        let allowed = matches!(value, "allowed" | "denied" | "unset");
        if !allowed {
            return Err(unauthorized_root("Invalid trust value"));
        }
        match category {
            "files" => binding.trust.files = value.into(),
            "instructions" => binding.trust.instructions = value.into(),
            "skillsCommands" => binding.trust.skills_commands = value.into(),
            "hooks" => binding.trust.hooks = value.into(),
            _ => return Err(unauthorized_root("Invalid trust category")),
        }
        *binding = binding.clone().with_checksum();
        Self::persist(&inner);
        Ok(())
    }

    pub fn get_trust(&self, project_id: &str) -> Option<TrustState> {
        self.lock().ok()?.bindings.get(project_id).map(|b| b.trust.clone())
    }

    pub fn read(
        &self,
        capability_id: &str,
        window_label: &str,
        relative_path: &str,
    ) -> Result<Value, WorkspaceError> {
        let (_root, project_id, _, _) = self.lookup_cap(capability_id, window_label)?;
        let _guard = self.begin_op(&project_id, None)?;
        let (root, _, _, _) = self.lookup_cap(capability_id, window_label)?;
        if is_hard_denied(relative_path) {
            return Err(hard_denied(relative_path));
        }
        let rel = RelativePath::parse(relative_path)?;
        let limited = read_file_limited(&root, &rel, READ_MAX_BYTES)?;
        if looks_binary(&limited.bytes) {
            return Ok(json!({
                "content": "",
                "revision": content_revision(&limited.bytes),
                "truncated": limited.truncated,
                "encoding": "binary",
                "relativePath": rel.as_display(),
                "size": limited.size,
            }));
        }
        let content = String::from_utf8_lossy(&limited.bytes).into_owned();
        Ok(json!({
            "content": content,
            "revision": content_revision(&limited.bytes),
            "truncated": limited.truncated,
            "encoding": "utf-8",
            "relativePath": rel.as_display(),
            "size": limited.size,
        }))
    }

    pub fn list(
        &self,
        capability_id: &str,
        window_label: &str,
        relative_path: &str,
        cursor: Option<&str>,
        request_id: Option<&str>,
    ) -> Result<Value, WorkspaceError> {
        let (_, project_id, _, _) = self.lookup_cap(capability_id, window_label)?;
        let _guard = self.begin_op(&project_id, request_id)?;
        if let Some(id) = request_id {
            if self.is_cancelled(id) {
                return Err(cancelled());
            }
        }
        let (root, _, generation, _) = self.lookup_cap(capability_id, window_label)?;
        if is_hard_denied(relative_path) {
            return Err(hard_denied(relative_path));
        }
        let rel = RelativePath::parse(relative_path)?;
        let has_git = root.join(".git").exists();
        let mut stack = IgnoreStack::new(has_git);
        self.load_ignore_chain(&root, &rel, &mut stack);
        let mut children = list_children(&root, &rel)?;
        children.sort_by(|a, b| a.0.cmp(&b.0));
        let start_after = cursor.unwrap_or("");
        let mut entries = Vec::new();
        for (name, is_dir, size) in children {
            if !start_after.is_empty() && name.as_str() <= start_after {
                continue;
            }
            let child_rel = if rel.components.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel.as_display(), name)
            };
            if stack.is_ignored(&child_rel, is_dir) {
                continue;
            }
            if entries.len() >= LIST_PAGE_SIZE {
                break;
            }
            entries.push(json!({
                "name": name,
                "relativePath": child_rel,
                "kind": if is_dir { "directory" } else { "file" },
                "size": size,
            }));
        }
        let next = if entries.len() == LIST_PAGE_SIZE {
            entries
                .last()
                .and_then(|e| e.get("name").and_then(|v| v.as_str()).map(str::to_string))
        } else {
            None
        };
        Ok(json!({
            "entries": entries,
            "cursor": next,
            "requestId": request_id,
            "rootGeneration": generation,
        }))
    }

    pub(crate) fn load_ignore_chain(&self, root: &Path, rel: &RelativePath, stack: &mut IgnoreStack) {
        let mut acc = RelativePath { components: vec![] };
        if let Ok(gi) = RelativePath::parse(&gitignore_path("")) {
            if let Ok(bytes) = read_file_bytes(root, &gi) {
                if let Ok(text) = String::from_utf8(bytes) {
                    stack.push_gitignore("", &text);
                }
            }
        }
        for component in &rel.components {
            acc.components.push(component.clone());
            if let Ok(gi) = RelativePath::parse(&gitignore_path(&acc.as_display())) {
                if let Ok(bytes) = read_file_bytes(root, &gi) {
                    if let Ok(text) = String::from_utf8(bytes) {
                        stack.push_gitignore(&acc.as_display(), &text);
                    }
                }
            }
        }
    }

    pub fn search(
        &self,
        capability_id: &str,
        window_label: &str,
        query: &str,
        request_id: Option<&str>,
    ) -> Result<Value, WorkspaceError> {
        let (_, project_id, _, _) = self.lookup_cap(capability_id, window_label)?;
        let _guard = self.begin_op(&project_id, request_id)?;
        if let Some(id) = request_id {
            if self.is_cancelled(id) {
                return Err(cancelled());
            }
        }
        let q = query.trim();
        if q.is_empty() {
            return Ok(json!({ "hits": [], "requestId": request_id, "truncated": false }));
        }
        let (root, _, _, _) = self.lookup_cap(capability_id, window_label)?;
        let has_git = root.join(".git").exists();
        let mut stack = IgnoreStack::new(has_git);
        if let Ok(gi) = RelativePath::parse(&gitignore_path("")) {
            if let Ok(bytes) = read_file_bytes(&root, &gi) {
                if let Ok(text) = String::from_utf8(bytes) {
                    stack.push_gitignore("", &text);
                }
            }
        }
        let mut hits = Vec::new();
        let mut stats = SearchStats {
            entries: 0,
            inspected: 0,
            started: std::time::Instant::now(),
            truncated: false,
        };
        self.search_walk(
            &root,
            &RelativePath { components: vec![] },
            &mut stack,
            q,
            request_id,
            &mut hits,
            0,
            &mut stats,
        )?;
        Ok(json!({ "hits": hits, "requestId": request_id, "truncated": stats.truncated }))
    }

    fn search_walk(
        &self,
        root: &Path,
        dir: &RelativePath,
        stack: &mut IgnoreStack,
        query: &str,
        request_id: Option<&str>,
        hits: &mut Vec<Value>,
        depth: usize,
        stats: &mut SearchStats,
    ) -> Result<(), WorkspaceError> {
        if hits.len() >= SEARCH_MAX_HITS
            || stats.entries >= SEARCH_MAX_ENTRIES
            || stats.inspected >= SEARCH_MAX_INSPECTED_BYTES
            || depth > SEARCH_MAX_DEPTH
            || stats.started.elapsed() >= std::time::Duration::from_millis(SEARCH_DEADLINE_MS)
        {
            stats.truncated = true;
            return Ok(());
        }
        if let Some(id) = request_id {
            if self.is_cancelled(id) {
                return Err(cancelled());
            }
        }
        let children = list_children(root, dir)?;
        for (name, is_dir, _) in children {
            if hits.len() >= SEARCH_MAX_HITS || stats.entries >= SEARCH_MAX_ENTRIES {
                stats.truncated = true;
                break;
            }
            stats.entries += 1;
            let child = dir.join_child(&name)?;
            let rel = child.as_display();
            if stack.is_ignored(&rel, is_dir) {
                continue;
            }
            if name.to_ascii_lowercase().contains(&query.to_ascii_lowercase()) {
                hits.push(json!({
                    "relativePath": rel,
                    "kind": "filename",
                }));
            }
            if is_dir {
                let before = stack.layer_count();
                if let Ok(gi) = RelativePath::parse(&gitignore_path(&rel)) {
                    if let Ok(bytes) = read_file_bytes(root, &gi) {
                        if let Ok(text) = String::from_utf8(bytes) {
                            stack.push_gitignore(&rel, &text);
                        }
                    }
                }
                self.search_walk(root, &child, stack, query, request_id, hits, depth + 1, stats)?;
                stack.truncate_layers(before);
            } else if let Ok(limited) = read_file_limited(root, &child, SEARCH_MAX_FILE_BYTES) {
                stats.inspected = stats.inspected.saturating_add(limited.bytes.len());
                if limited.bytes.len() <= SEARCH_MAX_FILE_BYTES && !looks_binary(&limited.bytes) {
                    if let Ok(text) = String::from_utf8(limited.bytes) {
                        for (i, line) in text.lines().enumerate() {
                            if line.to_ascii_lowercase().contains(&query.to_ascii_lowercase()) {
                                hits.push(json!({
                                    "relativePath": rel,
                                    "kind": "content",
                                    "line": i + 1,
                                    "excerpt": line.chars().take(200).collect::<String>(),
                                }));
                                break;
                            }
                        }
                    }
                }
            }
        }
        Ok(())
    }

    pub fn cancel_request(&self, request_id: &str) {
        if let Ok(inner) = self.lock() {
            inner.leases.cancel(request_id);
        }
    }

    fn is_cancelled(&self, request_id: &str) -> bool {
        self.lock()
            .ok()
            .map(|inner| inner.leases.is_cancelled(request_id))
            .unwrap_or(false)
    }

    pub fn create_file(
        &self,
        capability_id: &str,
        window_label: &str,
        relative_path: &str,
        content: &str,
        mode: &str,
        expected_revision: Option<&str>,
    ) -> Result<Value, WorkspaceError> {
        if content.len() > MUTATION_MAX_BYTES {
            return Err(limit_exceeded("File content exceeds the 1 MiB write limit"));
        }
        self.mutate(capability_id, window_label, |root| {
            if is_hard_denied(relative_path) {
                return Err(hard_denied(relative_path));
            }
            let rel = RelativePath::parse(relative_path)?;
            let exists = exists_nofollow(root, &rel);
            if mode != "overwrite" && exists {
                return Err(already_exists(&rel.as_display()));
            }
            if mode == "overwrite" {
                if !exists {
                    return Err(not_found(&rel.as_display()));
                }
                let expected = expected_revision.filter(|s| !s.is_empty()).ok_or_else(|| {
                    conflict(&rel.as_display())
                })?;
                let current = read_file_bytes(root, &rel)?;
                if content_revision(&current) != expected {
                    return Err(conflict(&rel.as_display()));
                }
                write_atomic(root, &rel, content.as_bytes())?;
            } else {
                create_new_exclusive(root, &rel, content.as_bytes())?;
            }
            let written = read_file_bytes(root, &rel)?;
            Ok(json!({
                "ok": true,
                "revision": content_revision(&written),
                "relativePath": rel.as_display(),
            }))
        })
    }

    pub fn edit_file(
        &self,
        capability_id: &str,
        window_label: &str,
        relative_path: &str,
        old_string: &str,
        new_string: &str,
        expected_revision: &str,
    ) -> Result<Value, WorkspaceError> {
        if new_string.len() > MUTATION_MAX_BYTES {
            return Err(limit_exceeded("File content exceeds the 1 MiB write limit"));
        }
        self.mutate(capability_id, window_label, |root| {
            if is_hard_denied(relative_path) {
                return Err(hard_denied(relative_path));
            }
            if old_string.is_empty() {
                return Err(ambiguous_edit());
            }
            let rel = RelativePath::parse(relative_path)?;
            let bytes = read_file_bytes(root, &rel)?;
            if content_revision(&bytes) != expected_revision {
                return Err(conflict(&rel.as_display()));
            }
            let text = String::from_utf8(bytes).map_err(|_| {
                WorkspaceError::new(super::error::BINARY, "File is not valid UTF-8")
            })?;
            let matches = text.matches(old_string).count();
            if matches != 1 {
                return Err(ambiguous_edit());
            }
            let next = text.replacen(old_string, new_string, 1);
            write_atomic(root, &rel, next.as_bytes())?;
            let written = read_file_bytes(root, &rel)?;
            Ok(json!({
                "ok": true,
                "revision": content_revision(&written),
                "relativePath": rel.as_display(),
            }))
        })
    }

    pub fn delete_file(
        &self,
        capability_id: &str,
        window_label: &str,
        relative_path: &str,
        expected_revision: &str,
    ) -> Result<Value, WorkspaceError> {
        self.mutate(capability_id, window_label, |root| {
            if is_hard_denied(relative_path) {
                return Err(hard_denied(relative_path));
            }
            let rel = RelativePath::parse(relative_path)?;
            let bytes = read_file_bytes(root, &rel)?;
            if content_revision(&bytes) != expected_revision {
                return Err(conflict(&rel.as_display()));
            }
            delete_file(root, &rel)?;
            Ok(json!({
                "ok": true,
                "revision": "",
                "relativePath": rel.as_display(),
            }))
        })
    }

    fn mutate<F>(&self, capability_id: &str, window_label: &str, f: F) -> Result<Value, WorkspaceError>
    where
        F: FnOnce(&Path) -> Result<Value, WorkspaceError>,
    {
        if !self.mutation_enabled() {
            return Err(mutation_disabled());
        }
        let (root, project_id, _, identity) = self.lookup_cap(capability_id, window_label)?;
        let _guard = self.begin_op(&project_id, None)?;
        let root_lock = {
            let mut inner = self.lock()?;
            inner.leases.root_lock(&identity)
        };
        let _serialized = root_lock
            .lock()
            .map_err(|_| WorkspaceError::new(PERMISSION_DENIED, "root lease poisoned"))?;
        // Re-check revocation after acquiring lease, immediately before side effects.
        #[cfg(test)]
        if self.revoke_before_commit.swap(false, Ordering::SeqCst) {
            if let Ok(mut inner) = self.lock() {
                self.revoke_project_locked(&mut inner, &project_id);
            }
        }
        let (root2, _, _, identity2) = self.lookup_cap(capability_id, window_label)?;
        if root != root2 || identity != identity2 {
            return Err(stale_capability());
        }
        f(&root2)
    }

    pub(crate) fn mutate_with_apply_permit<F>(
        &self,
        capability_id: &str,
        window_label: &str,
        f: F,
    ) -> Result<Value, WorkspaceError>
    where
        F: FnOnce(&Path) -> Result<Value, WorkspaceError>,
    {
        if !self.rollout().apply {
            return Err(mutation_disabled());
        }
        let (root, project_id, _, identity) = self.lookup_cap(capability_id, window_label)?;
        let _guard = self.begin_op(&project_id, None)?;
        let root_lock = {
            let mut inner = self.lock()?;
            inner.leases.root_lock(&identity)
        };
        let _serialized = root_lock
            .lock()
            .map_err(|_| WorkspaceError::new(PERMISSION_DENIED, "root lease poisoned"))?;
        let (root2, _, _, identity2) = self.lookup_cap(capability_id, window_label)?;
        if root != root2 || identity != identity2 {
            return Err(stale_capability());
        }
        f(&root2)
    }

    pub fn suite_capabilities(&self) -> Value {
        super::policy::discovery_matrix(self.rollout(), git_bin_exists())
    }

    pub fn reveal_path(&self, project_id: &str, window_label: &str) -> Result<String, WorkspaceError> {
        Self::require_main(window_label)?;
        let inner = self.lock()?;
        let binding = inner
            .bindings
            .get(project_id)
            .ok_or_else(|| unauthorized_root("No native binding exists for this project"))?;
        Ok(binding.display_path.clone())
    }
}

fn descriptor_json(
    project_id: &str,
    capability_id: &str,
    generation: &str,
    display: &str,
    status: &str,
    trust: &TrustState,
) -> Value {
    json!({
        "projectId": project_id,
        "capabilityId": capability_id,
        "rootGeneration": generation,
        "displayPath": display,
        "status": status,
        "trust": {
            "files": trust.files,
            "instructions": trust.instructions,
            "skillsCommands": trust.skills_commands,
            "hooks": trust.hooks,
        }
    })
}

fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|b| *b == 0)
}

fn git_bin_exists() -> bool {
    let names = ["git", "git.exe"];
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            for name in names {
                if dir.join(name).is_file() {
                    return true;
                }
            }
        }
    }
    false
}

struct SearchStats {
    entries: usize,
    inspected: usize,
    started: std::time::Instant,
    truncated: bool,
}

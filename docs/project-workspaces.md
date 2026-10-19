# Project Workspaces

Dango Projects group chats and, on desktop, may bind to one user-authorized directory.

## Authority

- Portable Project metadata (`MyProjects`) has no filesystem root.
- Directory access is granted only by the native folder picker or restore of a private native binding record.
- Runtime capabilities are bound to project ID, owner window (`main` only), and root generation.
- Quick, web, and mobile cannot use privileged bind/read/mutate APIs.
- A draft binding is a picker result held under a `draft:` id until it is re-keyed to a scope (`workspace:adopt-draft-binding`, main window only); leftover drafts are discarded at launch.
- Broad renderer `fs:*` and `execute_command` channels are unavailable. Generic Project shell is disabled.
- Native compiled rollout bits default export, source control, staging, apply, Quick Local Run, and managed worktrees off. App/user flags may only hide or revoke; they cannot grant native permission.

## Product surfaces

- **Project Files / Project Explorer**: paged, cancellable listing of eligible files.
- **Export / Save As**: native picker-owned destination. The renderer never receives a destination path.
- **Source Control**: read-only Git status/diff/log through a sanitized native broker when enabled.
- **Change Review**: agent create/edit/delete tools stage change sets; Project Files stay unchanged until Apply.
- **Quick Local Run**: optional embedded JavaScript profile. It is not a terminal, Node, npm, Python, or cloud sandbox. Currently unavailable (feasibility gate).
- **Isolated Checkout**: optional app-owned Git worktrees. Currently unavailable (feasibility gate).
- **Artifact Studio**: generated preview; a separate product domain.

## Context

- Explorer listing, search, and attach are ignore-aware and hard-deny secrets (`.env`, keys, `.git/`, etc.).
- On desktop, a Project chat may show a full-height file tree beside chat. Unfiled Recents chats do not get an explorer column. It is not a chip above the composer.
- Selected context is a one-send draft: max 20 entries and 512 KiB, with revision preflight and provider disclosure.
- Clicking a file selects it. Space attaches or removes it for the next send.

## Mutation

- Agent file tools stage native change sets. They do not write Project Files during a model run.
- Apply requires a native one-use ticket after preflight. Conflicts refuse overwrite. Partial apply is journaled honestly.
- Native replacement rejects 0 or >1 `oldString` matches.
- Failed writes leave the original file intact.
- High-risk bits can be rolled back independently without restoring generic `fs:*` or `execute_command`.

## Trust

Instructions (`AGENTS.md`, `CLAUDE.md`, supported Cursor rules), skills/commands, and hooks are independent trust categories. Instruction trust never enables skills, commands, or hooks. Project shell hooks stay disabled.

## Migration

Existing chat folders keep IDs, names, emoji, order, and default agent. `projectId` dual-writes with `folderId` for one compatibility release. Legacy `workspaceRoot` is a reconnect hint only and never auto-authorizes.

Removing a Project never deletes its directory.

---
type: decision
status: draft
description: "Read-only commands on MCP shell tools ask once and then run unasked in that scope; every other shell command or code run asks every time and never takes an Always grant"
generated: { by: claude/opus-5.5, at: 2026-10-20T05:00:00Z }
---
# ADR 0015: Command tools always ask; read-only MCP commands ask once

Status: **proposal**, written from the maintainer's instructions of 2026-10-20 ("If dangerous command needed, make llm ask"; "ls, df... should be auto allow"). The maintainer accepts it by setting `status: stable` and adding `verified`.

## Context

Slice 06c added the permission sheet with "Always in this scope". A grant applies only at the exact risk tier it was given at, and the risk engine rates each call from its arguments, so a grant never covers a call the engine rates higher. Since the blockers fix (2026-10-21), no grant ever covers a call that names a secret file, whatever its tier.

The engine finds dangerous commands by pattern. Its reviews ran about 100 destructive commands against it and closed every gap they found: recursive deletes in any flag order, spawn-style `{command, args}`, disk writes, `sudo` and more. But a list of patterns can never be complete. Command substitution (`rm -r $(echo ~)`), brace expansion and interpreter one-liners can still rate HIGH. A HIGH "Always" grant on a shell tool would then run them without asking.

## Decision

A tool that runs shell commands or arbitrary code is a **command tool**. A tool counts as one when its name or its description says it runs commands, a shell, a terminal, scripts or code. Command tools are treated like send, delete and pay tools:

- They ask every time and never offer "Always".
- They never use a scope or session grant, and grants stored for them before this decision are ignored.
- Their sheet says "Dango always asks before it runs commands."

Simple read-only commands are the exception. On an MCP shell tool (today every shell tool is one) the first read-only command asks, and its sheet offers "Always in this scope" ("Always in this chat" when the chat has no scope) and says "Always covers only read-only commands like this one. Other commands still ask every time." After Always, that tool's read-only commands run without asking in that scope; any other command of the tool still asks every time with no Always, because the grant is stored marked as covering read-only commands only and is never used as an ordinary grant (maintainer, 2026-10-22, replacing "read-only commands never ask" for MCP tools; this follows [ADR 0016](0016-outside-tools-and-device-only-chats.md)'s "ask once, then remember"). A Dango built-in shell tool, if one is ever added, would run read-only commands without asking. The scope's permission list shows the grant as "Read-only commands only", with Stop allowing. A call counts as read-only only when all of these hold:

- the tool is a local shell tool (never SQL, code, REPL, remote or other exec tools);
- it is a single command from a short allowlist (`ls`, `pwd`, `df`, `du`, `ps`, `cat`, `head`, `tail`, `wc`, `grep`, `find`, `git status`/`log`/`diff`/`show`…) with only allowed flags;
- the text uses plain characters only, so no quotes, `$`, `%`, `~`, wildcards, brackets, chaining, pipes or redirects;
- every argument key is a known one (`command`, `args`, `cwd`, `reason`…), so a decoy field can't hide the real request;
- `ls`, `du`, `cat`, `head`, `tail`, `wc`, `stat`, `grep` and `find` take only flags and numbers: a command that names a file or folder asks, because Dango doesn't know the server's working folder;
- it names no secret file (`.env`, `.ssh`, `.aws`, `.kube`, shell profiles, history…) in any argument, the `reason` text included, and no absolute, `..` or drive path;
- the arguments on their own rate no higher than MEDIUM.

An allowlist fails safe: anything it doesn't recognise asks. `cat "my file"` asks because of the quotes.

The model's own judgement of whether a command is safe is not used, because text the model reads (web pages, files, tool output) can tell it to call something harmless-sounding.

The risk engine keeps rating command calls. Its tier still decides how the sheet reads and how calls are audited, but no tier on its own lets a command tool run without asking; only the read-only allowlist does, and on MCP tools only after the user's read-only Always.

## Consequences

- The first read-only command per MCP shell tool and scope costs one click; with Always, later ones cost none. Once granted, the model's `reason` text goes to the server unasked with each read-only command (secret paths in it still ask).
- Prose over 140 characters or with secret-looking text (`reason`, `explanation`, `purpose`, `description`) asks with no Always, even after the read-only Always; Dango asks rather than shortening it.
- Every command outside the read-only allowlist costs one click per call. Adding a command to the allowlist is a code change with tests, never a grant.
- Detection by name and description can miss a command tool that hides its purpose. Such a tool still asks for anything the engine rates CRITICAL.
- Commands that name a file or folder ask, because Dango does not know the server's working folder; secret files never take a grant, for any tool. After the read-only Always, `ls -la`, `df -h` and `git status` run without asking, and `git show`/`git diff`/`git log` can still print files tracked in the repository.
- `git status`, `git diff` and `git log` can run programs set in the repository's own git config (fsmonitor, textconv, an external diff or pager). Changing that config needs a command that asks, so this is accepted.
- Read-only tools whose names mention commands (for example `list_commands`) keep "Always" unless their description says they run something.

## Links

- [Slice 06c plan](../specs/2026-10-17-slice-06c-permission-swarm-search.md), flow 7 in [UX flows](../specs/2026-10-16-ux-flows.md).
- [Known issues](../research/2026-10-19-redesign-known-issues.md), Permissions (06c).

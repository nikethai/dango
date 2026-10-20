---
type: decision
status: draft
description: "Read-only commands run without asking; every other shell command or code run asks every time and never takes an Always grant"
generated: { by: claude/opus-5.5, at: 2026-10-20T05:00:00Z }
---
# ADR 0015: Command tools ask unless the command is read-only

Status: **proposal**, written from the maintainer's instructions of 2026-10-20 ("If dangerous command needed, make llm ask"; "ls, df... should be auto allow"). The maintainer accepts it by setting `status: stable` and adding `verified`.

## Context

Slice 06c added the permission sheet with "Always in this scope". A grant applies only at the exact risk tier it was given at, and the risk engine rates each call from its arguments, so a grant never covers a call the engine rates higher.

The engine finds dangerous commands by pattern. Its reviews ran about 100 destructive commands against it and closed every gap they found: recursive deletes in any flag order, spawn-style `{command, args}`, disk writes, `sudo` and more. But a list of patterns can never be complete. Command substitution (`rm -r $(echo ~)`), brace expansion and interpreter one-liners can still rate HIGH. A HIGH "Always" grant on a shell tool would then run them without asking.

## Decision

A tool that runs shell commands or arbitrary code is a **command tool**. A tool counts as one when its name or its description says it runs commands, a shell, a terminal, scripts or code. Command tools are treated like send, delete and pay tools:

- They ask every time and never offer "Always".
- They never use a scope or session grant, and grants stored for them before this decision are ignored.
- Their sheet says "Dango always asks before it runs commands."

Simple read-only commands are the exception and run without asking. A call counts as read-only only when it is a single command, from a short allowlist (for example `ls`, `df`, `pwd`, `cat`, `grep`, `git status`), with no chaining, piping, redirection, command substitution or `sudo`, and the engine does not rate it CRITICAL (so `cat ~/.ssh/id_rsa` still asks). An allowlist fails safe: anything it doesn't recognise asks.

The model's own judgement of whether a command is safe is not used, because text the model reads (web pages, files, tool output) can tell it to call something harmless-sounding.

The risk engine keeps rating command calls. Its tier still decides how the sheet reads and how calls are audited, but no tier lets a command tool run without asking.

## Consequences

- Every command outside the read-only allowlist costs one click per call. Adding a command to the allowlist is a code change with tests, never a grant.
- Detection by name and description can miss a command tool that hides its purpose. Such a tool still asks for anything the engine rates CRITICAL.
- Read-only tools whose names mention commands (for example `list_commands`) keep "Always" unless their description says they run something.

## Links

- [Slice 06c plan](../specs/2026-10-17-slice-06c-permission-swarm-search.md), flow 7 in [UX flows](../specs/2026-10-16-ux-flows.md).
- [Known issues](../research/2026-10-19-redesign-known-issues.md), Permissions (06c).

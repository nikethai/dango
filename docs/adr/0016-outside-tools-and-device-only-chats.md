---
type: decision
status: draft
description: "MCP tools ask once and then remember per scope, whatever they call themselves; chats that hold device-only mail turn off every tool that sends content off the device"
generated: { by: claude/opus-5.5, at: 2026-10-21T19:00:00Z }
---
# ADR 0016: MCP tools ask once; device-only chats close outside tools

Status: **proposal**, written from the maintainer's answers of 2026-10-21 on [PR #110](https://github.com/nikethai/dango/pull/110). The maintainer accepts it by setting `status: stable` and adding `verified`.

## Context

The blockers fix (PR #110) stopped MCP tools from borrowing a built-in's low risk by name. MCP tools could still rate LOW from their own words: a tool named or described like a read (`list_issues`, `read_email`, `get_notes`) ran without asking. In a probe, 13 of 19 realistic MCP read tools did. A malicious server can simply name its tool like a read.

PR #110 also turned off web search and link reading in chats that hold device-only mail ([ADR 0003](0003-explicit-knowledge-source-connections.md)), but MCP tools, browser and video-URL reading and image generation were still offered there, and the switch-off was silent.

## Decision

- **MCP tools ask once, then remember.** No MCP tool rates below MEDIUM. The first call asks and offers "Always in this scope"; later calls in that scope run unasked. A server's own name, description and annotations (including any "read-only" hint) never lower a tier, because they are the server describing itself. Secret paths and the always-ask tools (send, delete, pay, commands, [ADR 0015](0015-command-tools-always-ask.md)) are unchanged. Read-only shell commands (`ls`, `git status`) on an MCP tool ask once too, with an Always that covers only that tool's read-only commands; every other command still asks every time ([ADR 0015](0015-command-tools-always-ask.md), maintainer 2026-10-22).
- **Device-only chats close outside tools.** On a turn that holds device-only text, every tool that sends content off the device is off: MCP tools (Dango can't know where a server sends data), browser and video-URL reading, image generation, web search and link reading. Computer use stays, because its screenshots go to the local model. The chat shows one quiet line: "Web and outside tools are off because this chat holds device-only mail."

## Consequences

- About one prompt per MCP tool per scope, instead of none for tools that sound harmless.
- A local model in a device-only chat can't use MCP servers at all, including ones the user trusts. A per-server trust setting can come later if wanted.
- The line under the answer explains why web and tools seem to be missing.

## Links

- [Blocker decisions plan](../specs/2026-10-21-blocker-decisions.md), [blockers plan](../specs/2026-10-21-redesign-blockers.md), [known issues](../research/2026-10-19-redesign-known-issues.md).

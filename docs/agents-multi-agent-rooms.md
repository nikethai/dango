# Agents & multi-agent team rooms

## Overview

**Agents** (formerly Copilots) are persona packages: prompt, avatar, model overrides, tools, and hooks.

Chat sessions can host a **room** of up to **3** agent members. Users `@`-mention agents in the chat dock (same interaction class as `$skills`).

**Swarm** is the chat's one multi-agent switch (Tools ▾ › Mode › Swarm, off by default). With Swarm **on** and **2+** speakers, the lead **orchestrator** creates a **task board**, **auto-assigns** owners, executes **sequentially**, then delivers. Uses more tokens. With Swarm **off**, a chat with several agents answers as one agent: the first speaker.

The older **Discuss** and **Work** room modes are no longer reachable from the UI (slice 06c). Sessions stored with `roomMode: 'discuss' | 'work'` read as Swarm off; their orchestrators below are kept until a cleanup removes them.

The user can interrupt anytime (new send aborts remaining queue).

## Glossary

| Term | Meaning |
|------|---------|
| Agent | Persona library entry (`AgentDetail` / legacy `CopilotDetail`) |
| Room | Session with `agentIds[]` members |
| Discuss turn | Short multi-agent reply (`Message.roomRole: 'turn'`) |
| Team answer | On-demand synthesis (`Message.roomRole: 'synthesis'`) |
| Work phases | `plan` · `do` · `review` · `deliver` |
| Swarm | Lead plan (task tools) → `assignTasks` → assignee `do` per task → lead `deliver` |
| Lead | First speaker / first `@` / `session.roomLeadId` |
| Agent mode | Existing tool-loop flag (`session.agentMode`) — required for tools on Work/Swarm **do** / **deliver** |
| Runtime | native / OpenClaw / Pi (team rooms are **native-only** in v1) |

## Data model

- `Session.agentIds?: string[]` — room members (migrated from `copilotId`)
- `Session.roomMode?: 'discuss' | 'work' | 'swarm'` — only `'swarm'` is written (Swarm on); Swarm off writes `undefined`. `isSwarmOn(roomMode)` in `src/shared/agent-room.ts`
- `Session.roomLeadId?: string` — optional lead override
- `Session.copilotId` — dual-written as `agentIds[0]` for one release
- `Message.agentId` / `Message.name` — speaker attribution
- `Message.mentionedAgentIds` — `@` chips on a user turn
- `Message.roomRole?: 'turn' | 'synthesis' | 'plan' | 'do' | 'review' | 'deliver'`
- `Message.roomRound?: number` — 1-based discuss round
- Session tasks (`taskStore`): `assigneeAgentId?`, `dependsOn?`, `createdBy?` for Swarm multi-owner board

## Caps

- `MAX_ROOM_AGENTS = 3`
- `MAX_ROOM_ROUNDS = 2` (default discuss after each user message)
- `MAX_ROOM_KEEP_DISCUSS_ROUNDS = 3` (with Keep discussing)
- `MAX_AGENT_TURNS_PER_USER_MSG = 6` (discuss)
- `MAX_SWARM_TASKS = 12`, `MAX_SWARM_TURNS = 15` (plan + tasks + deliver)
- Tools **off** in discuss / Work plan / review / synthesis
- Tools **on** for Work/Swarm **do** / **deliver** (assignee; respects agent toolAccess + agentMode)
- Swarm **plan**: **task tools only** (`create_task` / `update_task` / `list_tasks`)
- Single `@` → one full reply (no multi-room orchestration)
- Room multi injects a **user continue** bridge when history ends on assistant

## UX

- Settings → **Agents** (`/settings/agents`; `/settings/copilots` redirects)
- Composer: `@` chips for room members; **Swarm** is the last row of the Mode section in the Tools ▾ menu (both the desktop menu and the phone drawer; hidden for OpenClaw). Caption: “Several agents work on one answer”, or “Add 2 or 3 agents with @” when Swarm is on with fewer than 2 agents
- The room strip (“In this chat”) shows for a single agent, or for 2+ agents only when Swarm is on
- Plan mode is hidden only when Swarm is on in a room of 2+ agents
- **New chat (blank):** multi-select up to 3 agents via **search combobox** + selected chips (prompt preview only for 1 agent); Swarm can be turned on before the first send via draft props
- Assistant bubbles with `agentId` show **avatar + name** via `AgentSpeakerHeader`
- Discuss/plan/review turns grouped visually as **Team discussion**
- Team answer / Working / Deliverable badges on primary turns
- Room strip live status for legacy rooms: “Round 2/2 · Name speaking…”. A Swarm run shows its progress in the thread, not in the strip
- Task progress dock shows assignee when set
- Empty provider responses: one automatic retry, then soft placeholder

## Flow

### Discuss (legacy, unreachable from the UI)

```text
speakers = mentioned || room members
if 0: normal chat
if 1, or Swarm off: one assistant message, full reply (first speaker)
if 2+:
  for round 1..2:
    for each speaker: insert assistant { roomRole: turn, roomRound } → short discussion
  → show Team answer / Keep discussing (no auto synthesis)
```

### Work (legacy, unreachable from the UI)

```text
plan: each speaker once (tools off)
do: lead (tools on if agentMode)
review: peers (tools off)
deliver: lead (tools optional)
```

### Swarm

```text
runs when isSwarmOn(roomMode) and 2+ speakers (shouldRunMultiAgentRoom)
lead plan (task tools only) → create_task × N
  soft retry once if board empty; optional JSON fallback from plan prose
assignTasks (rule-based: explicit → name/tag match → least-loaded → lead)
for each ready task (deps done, sequential):
  assignee do (tools if agentMode); update status done/failed
  failed task: continue remaining ready (do not abort whole run)
lead deliver
interrupt: new user message aborts remaining queue
```

## Implementation map

| Area | Path |
|------|------|
| Pure room helpers | `src/shared/agent-room.ts` (`RoomMode`, `assignTasks`, swarm protocols) |
| Caps | `src/shared/types.ts` (`MAX_SWARM_TASKS=12`, `MAX_SWARM_TURNS=15`) |
| Swarm plan parse | `src/shared/swarm-plan.ts` |
| Swarm loop | `src/renderer/stores/session/multi-agent-room-swarm.ts` (`runAgentRoomSwarm`) |
| Room entry / modes | `src/renderer/stores/session/multi-agent-room.ts` (dispatches discuss/work/swarm) |
| Live/actions state | `src/renderer/stores/session/team-room-state.ts` |
| Task board | `src/renderer/stores/taskStore.ts` |
| Generation | `src/renderer/stores/session/generation.ts` |
| Submit wiring | `src/renderer/stores/session/messages.ts` |
| Speaker UI | `AgentSpeakerHeader`, `Message.tsx`, `MessageList.tsx` |
| Actions bar (legacy discuss, not rendered) | `TeamRoomActions.tsx` |
| Dock UI | `InputBox`, `ComposerToolsMenu` (Swarm row), `AgentPicker`, `AgentRoomStrip` |

## Related agent tools

When Work/Swarm **do** / **deliver** enable tools (and `agentMode` is on), agents can call the full tool surface for the session—including media tools:

- **`read_video_url`** — public YouTube / Vimeo / TikTok / Facebook links (metadata + transcript). See [video-url-reader.md](./video-url-reader.md).
- **`read_video`** — local uploaded `FILE_KEY` frame sample (not remote URLs).

Configure Video URL in **Settings → Video URL**.

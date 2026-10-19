/**
 * Plan mode for a chat (TASK-16): the one writer of `session.settings.planMode`. The toggle lives in the composer's
 * Tools menu (agent chats only) and on a stopped plan card whose Continue is blocked.
 */
import * as chatStore from '../chatStore'

/**
 * Turns plan mode on or off for a chat, keeping its other settings. A function updater, since `updateSession` merges
 * shallowly and an object patch would replace the whole `settings`.
 */
export async function setChatPlanMode(sessionId: string, on: boolean): Promise<void> {
  await chatStore.updateSession(sessionId, (session) => {
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return { ...session, settings: { ...session.settings, planMode: on } }
  })
}

/**
 * A stopped plan's "Turn on plan mode": plan mode back on, and Agent Mode with it when it is off (plan mode means
 * nothing without it). It changes the setting only; Continue stays the person's next, separate click.
 */
export async function turnOnChatPlanMode(sessionId: string): Promise<void> {
  await chatStore.updateSession(sessionId, (session) => {
    if (!session) throw new Error(`Session ${sessionId} not found`)
    return { ...session, agentMode: true, settings: { ...session.settings, planMode: true } }
  })
}

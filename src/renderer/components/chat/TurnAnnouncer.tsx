import type { Message } from '@shared/types'
import { type JSX, useEffect, useRef, useState } from 'react'
import {
  type AnnouncerState,
  initialAnnouncerState,
  nextAnnouncement,
  resumedAnnouncerState,
} from '@/packages/a11y/turnAnnouncement'
import { getLiveGenerationStartedAt } from '@/stores/session/session-live-generation'

const TICK_MS = 1_000

/** The visible timer's origin (Message.tsx, ThinkingGroupUI): when this message's live turn started. */
function liveStart(message: Message | undefined): number | undefined {
  return message?.generating ? getLiveGenerationStartedAt(message.id) : undefined
}

/**
 * A11Y1 rule 1: the one polite live region for the current turn. Mount once per chat with `key={message?.id}`. It
 * starts empty (a region that exists before its first words is announced reliably), checks the turn every second,
 * and stops ticking once the turn's final words are said. A turn that had already finished when mounted says nothing
 * until the same message generates again.
 */
export function TurnAnnouncer({ message }: { message?: Message }): JSX.Element {
  const [initial] = useState(() => initialAnnouncerState(message, liveStart(message)))
  const stateRef = useRef<AnnouncerState>(initial)
  const messageRef = useRef(message)
  messageRef.current = message
  const [text, setText] = useState('')
  const [done, setDone] = useState(initial.final)

  // The same message can run again (Continue on a stopped plan, a retry): that is a new turn to follow.
  const generating = Boolean(message?.generating)
  useEffect(() => {
    const m = messageRef.current
    if (generating && m && stateRef.current.final) {
      stateRef.current = resumedAnnouncerState(m, liveStart(m))
      setDone(false)
    }
  }, [generating])

  useEffect(() => {
    if (done) return
    const id = window.setInterval(() => {
      const m = messageRef.current
      if (!m) return
      // The live start can be registered after the message appears; the spoken seconds follow the visible timer.
      if (stateRef.current.startedAt === undefined) stateRef.current.startedAt = liveStart(m)
      const next = nextAnnouncement(m, stateRef.current, Date.now(), getLiveGenerationStartedAt(m.id) !== undefined)
      if (!next) return
      stateRef.current = next.state
      if (next.text) setText(next.text)
      if (next.state.final) setDone(true)
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [done])

  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  )
}

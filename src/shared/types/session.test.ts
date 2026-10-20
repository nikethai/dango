import { describe, expect, it } from 'vitest'
import { MessageSchema } from './session'

const base = { id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] }

describe('MessageSchema knowledgeIds', () => {
  it('keeps a list of ids', () => {
    expect(MessageSchema.parse({ ...base, knowledgeIds: ['k1', 'k2'] }).knowledgeIds).toEqual(['k1', 'k2'])
  })

  it('a malformed list drops the field instead of failing the message', () => {
    const parsed = MessageSchema.safeParse({ ...base, knowledgeIds: 'k1' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.knowledgeIds).toBeUndefined()
    expect(MessageSchema.parse({ ...base, knowledgeIds: [1, 'k2'] }).knowledgeIds).toBeUndefined()
  })
})

describe('MessageSchema swarm', () => {
  it('keeps the run id, task title and stopped-early mark', () => {
    const swarm = { runId: 'swarm-1', taskTitle: 'Draft', stoppedEarly: true }
    expect(MessageSchema.parse({ ...base, swarm }).swarm).toEqual(swarm)
  })

  it('keeps the could-not-plan note mark', () => {
    const swarm = { runId: 'swarm-1', note: true }
    expect(MessageSchema.parse({ ...base, swarm }).swarm).toEqual(swarm)
  })

  it('a malformed value drops the field instead of failing the message', () => {
    const parsed = MessageSchema.safeParse({ ...base, swarm: 5 })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.swarm).toBeUndefined()
    expect(MessageSchema.parse(base).swarm).toBeUndefined()
  })
})

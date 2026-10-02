import { describe, it, expect } from 'vitest'
import { sameMessage, rowStart } from '../../src/renderer/src/components/reading/conversationRows'
import type { ReadingMessage } from '../../src/shared/types'

const tool = (ok: boolean | null, summary = 'npm test'): ReadingMessage => ({
  id: 't1',
  role: 'tool',
  ts: 1,
  tool: { name: 'Bash', summary, ok }
})

describe('sameMessage', () => {
  it('treats a fresh copy of the same row as equal (every poll delivers new objects)', () => {
    const a: ReadingMessage = { id: 'a', role: 'assistant', ts: 5, text: '## hi\n- one' }
    expect(sameMessage(a, { ...a })).toBe(true)
    expect(sameMessage(tool(null), tool(null))).toBe(true)
  })

  it('sees a tool row finishing, so its state icon updates', () => {
    expect(sameMessage(tool(null), tool(true))).toBe(false)
    expect(sameMessage(tool(true), tool(false))).toBe(false)
  })

  it('sees changed text, summary, role or id', () => {
    const a: ReadingMessage = { id: 'a', role: 'assistant', ts: 5, text: 'x' }
    expect(sameMessage(a, { ...a, text: 'y' })).toBe(false)
    expect(sameMessage(a, { ...a, role: 'user' })).toBe(false)
    expect(sameMessage(a, { ...a, id: 'b' })).toBe(false)
    expect(sameMessage(tool(null, 'a'), tool(null, 'b'))).toBe(false)
  })
})

describe('rowStart', () => {
  it('mounts the newest rows first and everything once shown covers the list', () => {
    expect(rowStart(2000, 120)).toBe(1880)
    expect(rowStart(100, 120)).toBe(0)
    expect(rowStart(0, 120)).toBe(0)
  })
})

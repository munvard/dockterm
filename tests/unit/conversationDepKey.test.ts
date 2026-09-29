import { describe, it, expect } from 'vitest'
import { conversationDepKey } from '../../src/renderer/src/components/reading/conversationDepKey'
import type { ReadingMessage } from '../../src/shared/types'

const msg = (id: string): ReadingMessage => ({ id, role: 'assistant', ts: 0, text: id })

describe('conversationDepKey', () => {
  it('changes when the last message id changes even at a constant length', () => {
    // A capped conversation (trimConversation in sessionHistoryService) drops the
    // OLDEST message on every append past the cap, so length alone never changes —
    // this is exactly the case that broke autoscroll (TC-I3).
    const before = [msg('a'), msg('b'), msg('c')]
    const after = [msg('b'), msg('c'), msg('d')] // same length, appended + trimmed
    expect(conversationDepKey(before)).not.toBe(conversationDepKey(after))
  })

  it('is stable for an unchanged list', () => {
    const a = [msg('a'), msg('b')]
    const b = [msg('a'), msg('b')]
    expect(conversationDepKey(a)).toBe(conversationDepKey(b))
  })

  it('handles an empty list', () => {
    expect(conversationDepKey([])).toBe(':0')
  })
})

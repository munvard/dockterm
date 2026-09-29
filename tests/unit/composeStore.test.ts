/// <reference path="../../src/renderer/src/dockterm.d.ts" />
import { describe, it, expect, beforeEach } from 'vitest'
import { useComposeStore } from '../../src/renderer/src/state/useComposeStore'
import type { Attachment } from '../../src/renderer/src/components/chat/composerText'

const att = (id: string, path = `/p/${id}.png`): Attachment => ({ id, kind: 'image', path, name: id })

beforeEach(() => {
  useComposeStore.setState({ open: false, leafId: null, drafts: {}, attachments: {}, chips: {}, history: {} })
})

describe('commitSent: only what was sent goes (sol-A 5)', () => {
  it('an untouched composer is fully cleared', () => {
    const s = useComposeStore.getState()
    s.setDraftFor('l', 'hello')
    s.addAttachments('l', [att('a')])
    useComposeStore.getState().commitSent('l', { text: 'hello', attachmentIds: ['a'], chipIds: [] })
    const n = useComposeStore.getState()
    expect(n.drafts['l']).toBeUndefined()
    expect(n.attachments['l']).toEqual([])
  })

  it('text typed while the send waited stays', () => {
    const s = useComposeStore.getState()
    s.setDraftFor('l', 'hello')
    s.setDraftFor('l', 'hello and more') // typed during the image wait
    useComposeStore.getState().commitSent('l', { text: 'hello', attachmentIds: [], chipIds: [] })
    expect(useComposeStore.getState().drafts['l']).toBe(' and more')
  })

  it('an attachment added during the send stays, the sent one goes', () => {
    const s = useComposeStore.getState()
    s.addAttachments('l', [att('a')])
    s.addAttachments('l', [att('b')])
    useComposeStore.getState().commitSent('l', { text: '', attachmentIds: ['a'], chipIds: [] })
    expect(useComposeStore.getState().attachments['l']?.map((a) => a.id)).toEqual(['b'])
  })

  it('a replaced draft is not erased', () => {
    const s = useComposeStore.getState()
    s.setDraftFor('l', 'something else')
    useComposeStore.getState().commitSent('l', { text: 'hello', attachmentIds: [], chipIds: [] })
    expect(useComposeStore.getState().drafts['l']).toBe('something else')
  })

  it('sent chips and chips whose token vanished are dropped, a chip still in the draft stays', () => {
    const s = useComposeStore.getState()
    const sent = s.addChip('l', 'big paste')
    const stale = useComposeStore.getState().addChip('l', 'deleted token')
    const fresh = useComposeStore.getState().addChip('l', 'new paste')
    useComposeStore.getState().setDraftFor('l', `[Pasted text #${sent.id}] more [Pasted text #${fresh.id}]`)
    useComposeStore.getState().commitSent('l', {
      text: `[Pasted text #${sent.id}]`,
      attachmentIds: [],
      chipIds: [sent.id]
    })
    const ids = useComposeStore.getState().chips['l']?.map((c) => c.id)
    expect(ids).toEqual([fresh.id])
    expect(ids).not.toContain(stale.id)
  })
})

describe('removePane: no leak after a pane closes (sol-A 7)', () => {
  it('forgets draft, attachments, chips and history, and closes an overlay aimed at it', () => {
    const s = useComposeStore.getState()
    s.setDraftFor('gone', 'x')
    s.addAttachments('gone', [att('a')])
    s.addChip('gone', 'big')
    s.recordHistory('gone', 'old prompt')
    s.setDraftFor('kept', 'y')
    useComposeStore.setState({ open: true, leafId: 'gone' })
    useComposeStore.getState().removePane('gone')
    const n = useComposeStore.getState()
    expect(n.drafts).toEqual({ kept: 'y' })
    expect(n.attachments['gone']).toBeUndefined()
    expect(n.chips['gone']).toBeUndefined()
    expect(n.history['gone']).toBeUndefined()
    expect(n.open).toBe(false)
  })
})

describe('clearTextOnly (Insert)', () => {
  it('clears the draft and chips but keeps attachments', () => {
    const s = useComposeStore.getState()
    s.setDraftFor('l', 'x')
    s.addChip('l', 'big')
    s.addAttachments('l', [att('a')])
    useComposeStore.getState().clearTextOnly('l')
    const n = useComposeStore.getState()
    expect(n.drafts['l']).toBeUndefined()
    expect(n.chips['l']).toEqual([])
    expect(n.attachments['l']).toHaveLength(1)
  })
})

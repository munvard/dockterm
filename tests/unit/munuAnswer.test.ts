import { describe, it, expect } from 'vitest'
import { createAskTokens, isActionValidFor } from '@main/services/munuAskTokens'
import { answerSchema } from '@main/ipc/handlers/munu'
import { actionKeys, ESC, ENTER } from '../../src/renderer/src/components/terminal/askKeys'
import type { AskInfo, MunuAsk } from '@shared/types'

const ask = (over: Partial<MunuAsk> = {}): MunuAsk => ({
  leafId: 'leaf1',
  tabId: 'tab1',
  title: 'Proceed?',
  options: ['Yes', 'No', 'Type something'],
  descriptions: [null, null, null],
  steps: [],
  binary: false,
  multiSelect: false,
  checkable: [false, false, false],
  checked: [false, false, false],
  submitIndex: null,
  cursorRow: 0,
  visible: false,
  ...over
})

describe('one-shot ask tokens', () => {
  it('issues a token per ask and accepts it once', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    expect(a.token).toBeTruthy()
    expect(t.consume(a.token!, 'leaf1')?.wcId).toBe(1)
    expect(t.consume(a.token!, 'leaf1')).toBeNull()
  })

  it('keeps the token when the action is rejected, so the card can still answer', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    expect(t.consume(a.token!, 'leaf1', () => false)).toBeNull()
    expect(t.consume(a.token!, 'leaf1', () => true)?.wcId).toBe(1)
  })

  it('does not reissue a token for the same prompt after it was used', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    t.consume(a.token!, 'leaf1')
    const [again] = t.sync(1, [ask({ cursorRow: 1 })])
    expect(again.token).toBeUndefined()
  })

  it('keeps the token while the same prompt is re-reported, and replaces it when the prompt changes', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    const [same] = t.sync(1, [ask({ cursorRow: 2, visible: true })])
    expect(same.token).toBe(a.token)
    const [next] = t.sync(1, [ask({ title: 'Another?' })])
    expect(next.token).not.toBe(a.token)
    expect(t.consume(a.token!, 'leaf1')).toBeNull()
    expect(t.consume(next.token!, 'leaf1')).not.toBeNull()
  })

  it('a token is only valid for its own pane, and unknown tokens fail', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    expect(t.consume(a.token!, 'other-leaf')).toBeNull()
    expect(t.consume('nope', 'leaf1')).toBeNull()
  })

  it('a same-named leaf in two windows gets two independent tokens', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    const [b] = t.sync(2, [ask()])
    expect(a.token).not.toBe(b.token)
    expect(t.consume(b.token!, 'leaf1')?.wcId).toBe(2)
    expect(t.consume(a.token!, 'leaf1')?.wcId).toBe(1)
  })

  it('kills the token when the ask disappears or the window goes away', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask()])
    t.sync(1, [])
    expect(t.consume(a.token!, 'leaf1')).toBeNull()
    const [b] = t.sync(1, [ask()])
    t.dropWindow(1)
    expect(t.consume(b.token!, 'leaf1')).toBeNull()
  })

  it('strips any token a window tried to supply', () => {
    const t = createAskTokens()
    const [a] = t.sync(1, [ask({ token: 'forged' })])
    expect(a.token).not.toBe('forged')
    expect(t.consume('forged', 'leaf1')).toBeNull()
  })
})

describe('isActionValidFor', () => {
  it('checks indexes against the ask', () => {
    expect(isActionValidFor(ask(), { kind: 'pick', index: 2 })).toBe(true)
    expect(isActionValidFor(ask(), { kind: 'pick', index: 3 })).toBe(false)
    expect(isActionValidFor(ask(), { kind: 'text', index: 2, text: 'hi' })).toBe(true)
    expect(isActionValidFor(ask(), { kind: 'cancel' })).toBe(true)
  })

  it('submit needs a multi-select with a Submit row', () => {
    expect(isActionValidFor(ask(), { kind: 'submit', selected: [] })).toBe(false)
    expect(isActionValidFor(ask({ submitIndex: 2 }), { kind: 'submit', selected: [0] })).toBe(true)
    expect(isActionValidFor(ask({ submitIndex: 2 }), { kind: 'submit', selected: [9] })).toBe(false)
  })

  it('rejects control characters in free text', () => {
    for (const bad of ['a\rb', 'a\nb', '\x03', 'x\x1b[A', 'tab\t', '\x7f', '\x9b']) {
      expect(isActionValidFor(ask(), { kind: 'text', index: 2, text: bad }), JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('munu:answer schema', () => {
  const ok = { leafId: 'l', token: 't', action: { kind: 'pick', index: 0 } }
  it('accepts semantic actions', () => {
    expect(answerSchema.safeParse(ok).success).toBe(true)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'cancel' } }).success).toBe(true)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'submit', selected: [0, 2] } }).success).toBe(true)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'text', index: 1, text: 'hello world' } }).success).toBe(true)
  })

  it('rejects raw keys, a missing token, and control characters in text', () => {
    expect(answerSchema.safeParse({ leafId: 'l', keys: ['\x03', 'rm -rf ~', '\r'] }).success).toBe(false)
    expect(answerSchema.safeParse({ leafId: 'l', action: { kind: 'cancel' } }).success).toBe(false)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'keys', keys: ['\r'] } }).success).toBe(false)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'text', index: 0, text: 'ls\r' } }).success).toBe(false)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'text', index: 0, text: 'a\x1bb' } }).success).toBe(false)
    expect(answerSchema.safeParse({ ...ok, action: { kind: 'pick', index: -1 } }).success).toBe(false)
  })
})

describe('actionKeys (built by the owning renderer)', () => {
  const base = ask() as AskInfo
  it('cancel is Esc', () => expect(actionKeys(base, { kind: 'cancel' })).toEqual([ESC]))

  it('pick uses the number key on a single-select', () => {
    expect(actionKeys(base, { kind: 'pick', index: 1 })).toEqual(['2'])
  })

  it('pick refuses a free-text row and an out-of-range row', () => {
    expect(actionKeys(base, { kind: 'pick', index: 2 })).toBeNull()
    expect(actionKeys(base, { kind: 'pick', index: 7 })).toBeNull()
  })

  it('text only goes into a free-text row, and never carries controls', () => {
    expect(actionKeys(base, { kind: 'text', index: 2, text: 'hi' })).toEqual(['3', 'hi', ENTER])
    expect(actionKeys(base, { kind: 'text', index: 0, text: 'hi' })).toBeNull()
    expect(actionKeys(base, { kind: 'text', index: 2, text: 'a\r' })).toBeNull()
  })

  it('submit needs a Submit row', () => {
    expect(actionKeys(base, { kind: 'submit', selected: [0] })).toBeNull()
    const multi = ask({
      multiSelect: true,
      options: ['a', 'b', 'Submit'],
      checkable: [true, true, false],
      submitIndex: 2
    }) as AskInfo
    expect(actionKeys(multi, { kind: 'submit', selected: [1] })).toEqual([
      '\x1b[B',
      ENTER,
      '\x1b[B',
      ENTER
    ])
  })
})

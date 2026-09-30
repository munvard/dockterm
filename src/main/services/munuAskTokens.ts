import { randomUUID } from 'node:crypto'
import type { MunuAnswerAction, MunuAsk } from '@shared/types'

/** C0 controls (incl. Enter, Tab, Esc, Ctrl-C), DEL and C1 controls. */
export const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/

interface Entry {
  token: string
  wcId: number
  leafId: string
  sig: string
  used: boolean
  ask: MunuAsk
}

const sigOf = (a: MunuAsk): string => `${a.title ?? ''}${a.options.join('')}`

/**
 * One-shot ask tokens. Main issues a token per (window, pane, prompt) as the
 * window reports its asks, hands it only to the overlay, and honours an answer
 * only while that exact prompt is still the pane's current ask. A token dies
 * when used, when the prompt changes, or when the ask disappears.
 */
export function createAskTokens(): {
  sync: (wcId: number, asks: MunuAsk[]) => MunuAsk[]
  consume: (
    token: string,
    leafId: string,
    accept?: (ask: MunuAsk) => boolean
  ) => { wcId: number; ask: MunuAsk } | null
  dropWindow: (wcId: number) => void
} {
  const byKey = new Map<string, Entry>()
  const byToken = new Map<string, Entry>()
  const keyOf = (wcId: number, leafId: string): string => `${wcId}\0${leafId}`
  const remove = (key: string): void => {
    const e = byKey.get(key)
    if (e) byToken.delete(e.token)
    byKey.delete(key)
  }

  return {
    sync(wcId, asks) {
      const live = new Set<string>()
      const out = asks.map((a) => {
        const key = keyOf(wcId, a.leafId)
        live.add(key)
        let e = byKey.get(key)
        if (!e || e.sig !== sigOf(a)) {
          remove(key)
          e = { token: randomUUID(), wcId, leafId: a.leafId, sig: sigOf(a), used: false, ask: a }
          byKey.set(key, e)
          byToken.set(e.token, e)
        } else {
          e.ask = a
        }
        const { token: _drop, ...rest } = a
        void _drop
        return e.used ? rest : { ...rest, token: e.token }
      })
      for (const key of [...byKey.keys()]) {
        if (key.startsWith(`${wcId}\0`) && !live.has(key)) remove(key)
      }
      return out
    },
    consume(token, leafId, accept) {
      const e = byToken.get(token)
      if (!e || e.used || e.leafId !== leafId) return null
      // A rejected action leaves the token alive, so the card can still answer.
      if (accept && !accept(e.ask)) return null
      e.used = true
      return { wcId: e.wcId, ask: e.ask }
    },
    dropWindow(wcId) {
      for (const key of [...byKey.keys()]) if (key.startsWith(`${wcId}\0`)) remove(key)
    }
  }
}

/** True when `action` makes sense for `ask` (indexes in range, submit only on a
 * multi-select that has a Submit row, no control characters in typed text). */
export function isActionValidFor(ask: MunuAsk, action: MunuAnswerAction): boolean {
  const n = ask.options.length
  switch (action.kind) {
    case 'cancel':
      return true
    case 'pick':
      return action.index >= 0 && action.index < n
    case 'text':
      return action.index >= 0 && action.index < n && !CONTROL_CHARS.test(action.text)
    case 'submit':
      return ask.submitIndex != null && action.selected.every((i) => i >= 0 && i < n)
  }
}

import type { ReadingMessage } from '@shared/types'

/** `depKey` for useStickyScroll from a message list: length alone stays constant
 * once a long conversation hits its trim cap (new messages appended, old ones
 * dropped from the front at the same count), which would silently stop
 * autoscroll — the last message's id changes on every genuine append. Pure, no
 * React, so it's unit-testable without a DOM. */
export function conversationDepKey(messages: ReadingMessage[]): string {
  const last = messages.length ? messages[messages.length - 1].id : ''
  return `${last}:${messages.length}`
}

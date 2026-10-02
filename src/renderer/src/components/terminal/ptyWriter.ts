/** Split `data` into pieces of at most `size` UTF-16 units, never inside a surrogate pair. */
export function splitForWrite(data: string, size: number): string[] {
  const out: string[] = []
  for (let i = 0; i < data.length; ) {
    let end = Math.min(i + size, data.length)
    const last = data.charCodeAt(end - 1)
    if (end < data.length && end - 1 > i && last >= 0xd800 && last <= 0xdbff) end--
    out.push(data.slice(i, end))
    i = end
  }
  return out
}

/**
 * Ordered writes to one pty. A big paste goes out as several awaited chunks;
 * anything typed meanwhile (Enter, Ctrl+C, Ctrl+D) queues behind it instead of
 * landing in the middle of the paste. With nothing queued, a small write is
 * sent at once, so typing latency is unchanged. A failed write drops the queue.
 */
export function createPtyWriter(
  send: (data: string) => Promise<boolean>,
  chunk: number
): (data: string) => void {
  const queue: string[] = []
  let busy = false
  const drain = async (): Promise<void> => {
    busy = true
    try {
      while (queue.length) {
        for (const part of splitForWrite(queue.shift()!, chunk)) {
          if (!(await send(part))) {
            queue.length = 0
            return
          }
        }
      }
    } finally {
      busy = false
    }
  }
  return (data) => {
    if (!busy && data.length <= chunk) {
      void send(data)
      return
    }
    queue.push(data)
    if (!busy) void drain()
  }
}

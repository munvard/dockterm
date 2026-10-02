import { parentPort, type MessagePort } from 'node:worker_threads'
import { ContentScanner, matcherFor } from './contentCore'
import type { FeedMsg, SearchIn, SearchOut } from './protocol'

const parent = parentPort
if (!parent) throw new Error('contentWorker must run in a worker thread')
const post = (m: SearchOut): void => parent.postMessage(m)

parent.on('message', (msg: SearchIn) => {
  if (msg.t !== 'attach') return
  const port = msg.port as unknown as MessagePort
  const shared = new Int32Array(msg.shared)
  const matcher = matcherFor(msg.opts)
  if ('error' in matcher) {
    post({ t: 'done', id: msg.id, error: matcher.error })
    port.close()
    return
  }
  const scanner = new ContentScanner(msg.root, matcher.re, shared, {
    progress: (files, scanned) => post({ t: 'progress', id: msg.id, files, scanned })
  })
  // Chunks are handled strictly one after another; the feeder holds a small credit window.
  let chain: Promise<void> = Promise.resolve()
  port.on('message', (m: FeedMsg) => {
    if ('files' in m) {
      chain = chain.then(async () => {
        await scanner.scanChunk(m.files)
        port.postMessage({ ack: true })
      })
    } else if (m.end) {
      chain = chain.then(() => {
        scanner.flush(false)
        port.close()
        post({ t: 'done', id: msg.id })
      })
    }
  })
})

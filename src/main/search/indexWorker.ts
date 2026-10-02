import { parentPort, workerData, type MessagePort } from 'node:worker_threads'
import { IndexerCore } from './indexCore'
import { feedContent, PortSink } from './contentCore'
import { SHARED, type IndexIn, type IndexOut } from './protocol'

const port = parentPort
if (!port) throw new Error('indexWorker must run in a worker thread')
const post = (m: IndexOut): void => port.postMessage(m)

const core = new IndexerCore((workerData as { root: string }).root, (status) => post({ t: 'status', status }))
// Latest query id per caller: a query that was overtaken while queued is skipped.
const latest = new Map<number, number>()

port.on('message', (msg: IndexIn) => {
  switch (msg.t) {
    case 'query': {
      latest.set(msg.owner, msg.id)
      setImmediate(() => {
        if (latest.get(msg.owner) !== msg.id) {
          post({ t: 'queryStale', id: msg.id, owner: msg.owner })
          return
        }
        try {
          const { results, status } = core.query(msg.query, {
            includeIgnored: msg.includeIgnored,
            kinds: msg.kinds,
            limit: msg.limit,
            recent: msg.recent
          })
          post({ t: 'queryResult', id: msg.id, owner: msg.owner, results, status })
        } catch (e) {
          post({ t: 'error', message: e instanceof Error ? e.message : String(e) })
          post({ t: 'queryStale', id: msg.id, owner: msg.owner })
        }
      })
      break
    }
    case 'watch':
      core.applyWatch(msg.events)
      break
    case 'refresh':
      void core.refresh()
      break
    case 'status':
      void core.start()
      post({ t: 'status', status: core.status() })
      break
    case 'content': {
      const shared = new Int32Array(msg.shared)
      const sinks = (msg.ports as unknown as MessagePort[]).map((p) => new PortSink(p))
      void (async () => {
        await core.waitReady(msg.opts.includeIgnored, () => Atomics.load(shared, SHARED.CANCEL) === 1)
        const candidates = core.contentCandidates(msg.opts)
        post({ t: 'contentStart', id: msg.id, total: candidates.length })
        await feedContent(candidates, sinks, shared)
        post({ t: 'contentFed', id: msg.id })
      })().catch((e) => post({ t: 'error', message: e instanceof Error ? e.message : String(e) }))
      break
    }
  }
})

void core.start()

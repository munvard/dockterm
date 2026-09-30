import { parentPort, workerData } from 'node:worker_threads'
import { UsageScanner, type ScanReply, type ScanRequest } from './usageScanner'

// Scan + parse + aggregate off the main thread; only the small snapshot crosses back.
const scanner = new UsageScanner((workerData as { projectsDir: string }).projectsDir)

parentPort?.on('message', (req: ScanRequest) => {
  void scanner.scan().then(
    (changed) => {
      const reply: ScanReply = { id: req.id, changed, snapshot: scanner.snapshot(Date.now(), req.budgets) }
      parentPort?.postMessage(reply)
    },
    () => {
      const reply: ScanReply = { id: req.id, changed: false, snapshot: scanner.snapshot(Date.now(), req.budgets) }
      parentPort?.postMessage(reply)
    }
  )
})

import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { getConversation as GetConversation } from '@main/services/sessionHistoryService'

// sessionHistoryService reads CLAUDE_CONFIG_DIR at module load (PROJECTS_DIR is a
// top-level const), so the override has to be set before a fresh import of it.
let root: string
let getConversation: typeof GetConversation

const slugFor = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

function transcriptPath(cwd: string, file = 'session1.jsonl'): string {
  const dir = join(root, 'projects', slugFor(cwd))
  mkdirSync(dir, { recursive: true })
  return join(dir, file)
}

const line = (o: unknown): string => JSON.stringify(o) + '\n'
const userLine = (uuid: string, text: string): string =>
  line({ type: 'user', uuid, timestamp: '2026-06-23T10:00:00.000Z', message: { content: [{ type: 'text', text }] } })
const assistantLine = (uuid: string, text: string): string =>
  line({
    type: 'assistant',
    uuid,
    timestamp: '2026-06-23T10:00:01.000Z',
    message: { content: [{ type: 'text', text }] }
  })

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'dockterm-sessionhistory-')))
  process.env.CLAUDE_CONFIG_DIR = root
  const mod = await import('@main/services/sessionHistoryService')
  getConversation = mod.getConversation
})

afterAll(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  rmSync(root, { recursive: true, force: true })
})

describe('getConversation concurrency', () => {
  it('does not duplicate messages when two callers race the same leaf/transcript', async () => {
    const cwd = '/Users/test/concurrent'
    const path = transcriptPath(cwd)
    writeFileSync(
      path,
      userLine('u1', 'please help me fix the login bug now') +
        assistantLine('a1', 'Sure, I will look at the login bug right now')
    )
    // bestMatch needs MIN_HITS (2) distinct sample lines found in the transcript
    // tail for a confident fingerprint match.
    const sample = ['please help me fix the login bug now', 'Sure, I will look at the login bug right now']

    // Two "surfaces" (Reading panel + Chat mode) polling the same leaf at once —
    // this used to both read the pre-mutation offset, both parse the same
    // appended bytes, and both advance the offset past where either reached.
    const [a, b] = await Promise.all([
      getConversation(cwd, sample, 'leaf-race', true),
      getConversation(cwd, sample, 'leaf-race', true)
    ])

    expect(a.messages).toHaveLength(2)
    expect(b.messages).toHaveLength(2)
    expect(a.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(b.messages.map((m) => m.id)).toEqual(['u1', 'a1'])
  })
})

describe('getConversation revision / unchanged', () => {
  it('reports unchanged when sinceRevision matches, and the new content otherwise', async () => {
    const cwd = '/Users/test/revision'
    const path = transcriptPath(cwd)
    writeFileSync(
      path,
      userLine('u1', 'please help me fix the login bug now') +
        assistantLine('a1', 'Sure, I will look at the login bug right now')
    )
    const sample = ['please help me fix the login bug now', 'Sure, I will look at the login bug right now']

    const first = await getConversation(cwd, sample, 'leaf-rev', true)
    expect(first.messages).toHaveLength(2)
    expect(first.unchanged).toBeFalsy()
    const rev1 = first.revision

    const stale = await getConversation(cwd, sample, 'leaf-rev', true, rev1)
    expect(stale.unchanged).toBe(true)
    expect(stale.messages).toEqual([])

    appendFileSync(path, assistantLine('a2', 'Done, the login bug is fixed'))
    const grown = await getConversation(cwd, sample, 'leaf-rev', true, rev1)
    expect(grown.unchanged).toBeFalsy()
    expect(grown.revision).toBeGreaterThan(rev1)
    expect(grown.messages.map((m) => m.id)).toEqual(['u1', 'a1', 'a2'])
  })
})

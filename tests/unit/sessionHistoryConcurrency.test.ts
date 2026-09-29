import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type {
  getConversation as GetConversation,
  serialize as Serialize
} from '@main/services/sessionHistoryService'

// sessionHistoryService reads CLAUDE_CONFIG_DIR at module load (PROJECTS_DIR is a
// top-level const), so the override has to be set before a fresh import of it.
let root: string
let getConversation: typeof GetConversation
let serialize: typeof Serialize

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
  serialize = mod.serialize
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

describe('revisions never collide across transcripts (I7)', () => {
  it('switching a pane to another session at an equal per-file revision is not "unchanged"', async () => {
    const cwd = '/Users/test/switch'
    const a = transcriptPath(cwd, 'sess-a.jsonl')
    const b = transcriptPath(cwd, 'sess-b.jsonl')
    writeFileSync(
      a,
      userLine('ua1', 'alpha question about the parser module') +
        assistantLine('aa1', 'alpha answer about the parser module')
    )
    writeFileSync(
      b,
      userLine('ub1', 'bravo question about the renderer code') +
        assistantLine('ab1', 'bravo answer about the renderer code')
    )
    const sampleA = ['alpha question about the parser module', 'alpha answer about the parser module']
    const sampleB = ['bravo question about the renderer code', 'bravo answer about the renderer code']

    const first = await getConversation(cwd, sampleA, 'leaf-switch', true)
    expect(first.messages.map((m) => m.id)).toEqual(['ua1', 'aa1'])

    // Same pane now shows B; the chat still holds A's revision.
    const second = await getConversation(cwd, sampleB, 'leaf-switch', true, first.revision)
    expect(second.unchanged).toBeFalsy()
    expect(second.messages.map((m) => m.id)).toEqual(['ub1', 'ab1'])
    expect(second.revision).not.toBe(first.revision)
  })
})

describe('pane keys keep windows apart', () => {
  it('a pane key from another window cannot inherit a sticky binding', async () => {
    const cwd = '/Users/test/isolated'
    const path = transcriptPath(cwd, 'iso.jsonl')
    writeFileSync(
      path,
      userLine('u1', 'please help me fix the login bug now') +
        assistantLine('a1', 'Sure, I will look at the login bug right now')
    )
    const sample = ['please help me fix the login bug now', 'Sure, I will look at the login bug right now']
    const mine = await getConversation(cwd, sample, '1\0leaf', true)
    expect(mine.messages.length).toBeGreaterThan(0)
    // Another window, SAME leafId, nothing matching, "Claude active" (sticky):
    const other = await getConversation(cwd, ['unrelated text that matches nothing here'], '2\0leaf', true)
    expect(other.messages).toEqual([])
    // ...while the original window keeps its sticky binding.
    const again = await getConversation(cwd, ['unrelated text that matches nothing here'], '1\0leaf', true)
    expect(again.messages.length).toBeGreaterThan(0)
  })

  it('drops a sticky binding when the pane is asked about a different project', async () => {
    const cwdA = '/Users/test/proj-a'
    const cwdB = '/Users/test/proj-b'
    const path = transcriptPath(cwdA, 'a.jsonl')
    writeFileSync(
      path,
      userLine('u1', 'please help me fix the login bug now') +
        assistantLine('a1', 'Sure, I will look at the login bug right now')
    )
    const sample = ['please help me fix the login bug now', 'Sure, I will look at the login bug right now']
    const bound = await getConversation(cwdA, sample, '3\0leaf', true)
    expect(bound.messages.length).toBeGreaterThan(0)
    const asked = await getConversation(cwdB, ['nothing matches here at all, really'], '3\0leaf', true)
    expect(asked.messages).toEqual([])
  })
})

describe('serialize (Codex 11)', () => {
  it('a failing job rejects its own caller but raises no unhandled rejection', async () => {
    const seen: unknown[] = []
    const onUnhandled = (reason: unknown): void => void seen.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      await expect(serialize('/x/fail.jsonl', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom')
      // Let any stray rejection surface (unhandledRejection fires after the microtask queue drains).
      await new Promise((r) => setTimeout(r, 20))
      expect(seen).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('still runs the next job for the same path after a failure, in order', async () => {
    const order: number[] = []
    const first = serialize('/x/seq.jsonl', async () => {
      order.push(1)
      throw new Error('first fails')
    })
    const second = serialize('/x/seq.jsonl', async () => {
      order.push(2)
      return 'ok'
    })
    await expect(first).rejects.toThrow()
    await expect(second).resolves.toBe('ok')
    expect(order).toEqual([1, 2])
  })
})

describe('revision across a rotated transcript (Codex 12)', () => {
  it('a truncated transcript is re-parsed and never answered "unchanged"', async () => {
    const cwd = '/Users/test/rotate'
    const path = transcriptPath(cwd)
    const sample = ['please rotate this transcript now', 'Rotating the transcript right away']
    const pad = 'padding so the first file is clearly longer than its replacement '.repeat(6)
    writeFileSync(
      path,
      userLine('r1', sample[0]) + assistantLine('r2', sample[1]) + assistantLine('r3', pad) + assistantLine('r4', pad)
    )
    const before = await getConversation(cwd, sample, 'leaf-rotate', true)
    expect(before.messages.length).toBe(4)

    // Rotation: the file is replaced by a shorter one (size < the cached offset).
    writeFileSync(path, userLine('n1', sample[0]) + assistantLine('n2', sample[1]))
    const after = await getConversation(cwd, sample, 'leaf-rotate', true, before.revision)
    expect(after.unchanged).toBeUndefined()
    expect(after.revision).toBeGreaterThan(before.revision)
    expect(after.messages.length).toBe(2)
  })
})

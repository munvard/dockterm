#!/usr/bin/env node
// Benchmark for the search engine (index build, Quick Open, content search, event-loop lag).
//
//   node --expose-gc scripts/bench-search.mjs --root <dir> [--needle <text>] [--tmp <dir>] [--json]
//   node --expose-gc scripts/bench-search.mjs --synthetic <dir> --files 200000
//
// It bundles the real engine sources (src/main/search, src/shared/search) with
// esbuild into --tmp, so the numbers are for the code that ships.
import { build } from 'esbuild'
import { Worker, MessageChannel } from 'node:worker_threads'
import { monitorEventLoopDelay, performance } from 'node:perf_hooks'
import { mkdirSync, writeFileSync, existsSync, readdirSync, mkdtempSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir, platform, cpus, release } from 'node:os'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const args = process.argv.slice(2)
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : def
}
const flag = (name) => args.includes(`--${name}`)

const pct = (arr, p) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]
}
const ms = (n) => Math.round(n * 100) / 100
const mb = (n) => Math.round((n / 1048576) * 10) / 10

function synthesize(dir, files) {
  // A believable monorepo: packages with src trees, a node_modules forest, build output.
  const rnd = (() => {
    let s = 12345
    return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  })()
  const words = ['button', 'modal', 'store', 'router', 'parser', 'config', 'utils', 'index', 'service', 'view', 'model', 'handler', 'auth', 'cache', 'queue', 'worker', 'theme', 'layout', 'panel', 'terminal']
  const exts = ['ts', 'tsx', 'js', 'json', 'css', 'md']
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, '.gitignore'), 'dist/\nbuild/\n*.log\n')
  let made = 0
  const makeDir = (path, depth, budget) => {
    mkdirSync(path, { recursive: true })
    const n = Math.min(budget, 6 + Math.floor(rnd() * 20))
    for (let i = 0; i < n && made < files; i++) {
      const w = words[Math.floor(rnd() * words.length)]
      writeFileSync(join(path, `${w}${Math.floor(rnd() * 1000)}.${exts[Math.floor(rnd() * exts.length)]}`), `export const ${w} = ${i}\n// ${w} needle-less filler\n`)
      made++
    }
    if (depth < 6) {
      const subs = 2 + Math.floor(rnd() * 3)
      for (let i = 0; i < subs && made < files; i++) {
        makeDir(join(path, `${words[Math.floor(rnd() * words.length)]}-${i}`), depth + 1, budget)
      }
    }
  }
  const third = Math.floor(files / 3)
  let top = 0
  while (made < third) makeDir(join(dir, 'packages', `pkg-${top++}`, 'src'), 0, 24)
  const nmTarget = Math.floor(files * 0.6)
  top = 0
  while (made < nmTarget) makeDir(join(dir, 'node_modules', `dep-${top++}`, 'lib'), 3, 24)
  top = 0
  while (made < files) makeDir(join(dir, 'dist', `chunk-${top++}`), 4, 24)
  // One planted string deep inside an ignored folder, for the content search.
  const deep = join(dir, 'node_modules', 'dep-0', 'lib', 'planted')
  mkdirSync(deep, { recursive: true })
  writeFileSync(join(deep, 'hidden.js'), '// the-planted-needle-xyzzy lives only in node_modules\n')
  return made
}

if (opt('synthetic')) {
  const dir = resolve(opt('synthetic'))
  if (!existsSync(dir) || readdirSync(dir).length === 0) {
    const t0 = performance.now()
    const n = synthesize(dir, Number(opt('files', '200000')))
    console.log(`synthetic tree: ${n} files in ${dir} (${Math.round(performance.now() - t0)} ms)`)
  } else {
    console.log(`synthetic tree already exists: ${dir}`)
  }
  if (!opt('root')) process.exit(0)
}

const root = resolve(opt('root', repo))
const needle = opt('needle', 'the-planted-needle-xyzzy')
const tmp = resolve(opt('tmp', join(tmpdir(), 'dockterm-bench')))
mkdirSync(tmp, { recursive: true })

const bundleDir = opt('bundle') ? resolve(opt('bundle')) : tmp
if (!opt('bundle')) {
  await build({
    entryPoints: {
      indexCore: join(repo, 'src/main/search/indexCore.ts'),
      indexWorker: join(repo, 'src/main/search/indexWorker.ts'),
      contentWorker: join(repo, 'src/main/search/contentWorker.ts')
    },
    outdir: tmp,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outExtension: { '.js': '.cjs' },
    tsconfig: join(repo, 'tsconfig.node.json'),
    logLevel: 'error'
  })
}
const requireCjs = (await import('node:module')).createRequire(import.meta.url)
const { IndexerCore } = requireCjs(join(bundleDir, 'indexCore.cjs'))

const out = {
  host: { platform: platform(), release: release(), cpu: cpus()[0]?.model, cores: cpus().length, node: process.version },
  root
}
const gc = () => globalThis.gc?.()

// ---------- 1. index build in a worker, main-thread event-loop lag ----------
async function workerBuild() {
  const h = monitorEventLoopDelay({ resolution: 5 })
  const worker = new Worker(join(bundleDir, 'indexWorker.cjs'), { workerData: { root } })
  const t0 = performance.now()
  let tUsable = 0
  let tReady = 0
  let last = null
  h.enable()
  await new Promise((resolveP, rejectP) => {
    worker.on('error', rejectP)
    worker.on('message', (m) => {
      if (m.t !== 'status') return
      last = m.status
      if (!tUsable && (m.status.phase === 'ignored' || m.status.phase === 'ready')) tUsable = performance.now() - t0
      if (m.status.phase === 'ready') {
        tReady = performance.now() - t0
        resolveP()
      }
    })
  })
  h.disable()
  return { worker, status: last, tUsable, tReady, lagMaxMs: h.max / 1e6, lagP99Ms: h.percentile(99) / 1e6, lagMeanMs: h.mean / 1e6 }
}

const built = await workerBuild()
out.indexBuild = {
  filesAndDirs: built.status.files + built.status.dirs,
  files: built.status.files,
  truncated: built.status.truncated,
  usableAfterMs: ms(built.tUsable),
  completeAfterMs: ms(built.tReady),
  mainLoopLagMaxMs: ms(built.lagMaxMs),
  mainLoopLagP99Ms: ms(built.lagP99Ms),
  mainLoopLagMeanMs: ms(built.lagMeanMs)
}

// ---------- 2. Quick Open through the worker, from the main thread ----------
let qid = 1
const ask = (query, includeIgnored = false, owner = 1) =>
  new Promise((resolveP) => {
    const id = qid++
    const onMsg = (m) => {
      if ((m.t === 'queryResult' || m.t === 'queryStale') && m.id === id) {
        built.worker.off('message', onMsg)
        resolveP(m)
      }
    }
    built.worker.on('message', onMsg)
    built.worker.postMessage({ t: 'query', id, owner, query, includeIgnored, kinds: 'files', limit: 100, recent: [] })
  })

// Realistic queries: fragments of real names, a subsequence, a folder/name path, an extension filter.
const sample = (await ask('', true)).results
const probe = await ask('s', true)
const names = []
{
  const seedHits = [...probe.results.hits]
  for (const q of ['a', 'e', 'i', 'o', 'u', 'in', 'co', 'te']) {
    names.push(...(await ask(q, true)).results.hits.map((x) => x.relPath))
  }
  names.push(...seedHits.map((x) => x.relPath))
}
const queries = []
for (const p of names.slice(0, 400)) {
  const base = p.slice(p.lastIndexOf('/') + 1)
  queries.push(base.slice(0, 3), base.slice(0, 5), base.replace(/[aeiou]/g, '').slice(0, 6), p.split('/').slice(-2).join('/').slice(0, 9))
}
queries.push('*.ts', '*.json config', 'index.ts:12', 'btn', 'readme')
void sample
const timeQueries = async (includeIgnored) => {
  const times = []
  let totalHits = 0
  for (const q of queries) {
    if (!q) continue
    const t = performance.now()
    const r = await ask(q, includeIgnored)
    times.push(performance.now() - t)
    totalHits += r.results?.hits.length ?? 0
  }
  return { n: times.length, p50Ms: ms(pct(times, 50)), p95Ms: ms(pct(times, 95)), maxMs: ms(Math.max(...times)), avgHits: ms(totalHits / times.length) }
}
out.quickOpenRoundTrip = { ignoredOff: await timeQueries(false), ignoredOn: await timeQueries(true) }
const noise = await ask('node_modules', true)
out.quickOpenSample = { query: 'node_modules', total: noise.results.total, first: noise.results.hits[0]?.relPath }

// ---------- 3. include-ignored proof ----------
const probeName = opt('ignored-probe', 'needle')
const off = await ask(probeName, false)
const on = await ask(probeName, true)
out.ignoredToggle = {
  probe: probeName,
  hitsInNodeModulesOff: off.results.hits.filter((h) => h.relPath.includes('node_modules/')).length,
  hitsInNodeModulesOn: on.results.hits.filter((h) => h.relPath.includes('node_modules/')).length
}

// ---------- 4. content search through the real worker pipeline ----------
async function contentSearch(query, includeIgnored) {
  const sab = new SharedArrayBuffer(8 * 4)
  const shared = new Int32Array(sab)
  const scanners = [new Worker(join(bundleDir, 'contentWorker.cjs')), new Worker(join(bundleDir, 'contentWorker.cjs'))]
  const opts = { query, caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '', includeIgnored }
  const id = 1
  const feederPorts = []
  const found = []
  let doneCount = 0
  const h = monitorEventLoopDelay({ resolution: 5 })
  const t0 = performance.now()
  h.enable()
  const finished = new Promise((resolveP) => {
    for (const w of scanners) {
      const ch = new MessageChannel()
      feederPorts.push(ch.port1)
      w.on('message', (m) => {
        if (m.t === 'progress') for (const f of m.files) found.push(f.relPath)
        else if (m.t === 'done' && ++doneCount === scanners.length) resolveP()
      })
      w.postMessage({ t: 'attach', id, root, opts, port: ch.port2, shared: sab }, [ch.port2])
    }
  })
  let total = 0
  const onMsg = (m) => {
    if (m.t === 'contentStart') total = m.total
  }
  built.worker.on('message', onMsg)
  built.worker.postMessage({ t: 'content', id, opts, ports: feederPorts, shared: sab }, feederPorts)
  await finished
  const elapsed = performance.now() - t0
  h.disable()
  built.worker.off('message', onMsg)
  for (const w of scanners) await w.terminate()
  return {
    query,
    includeIgnored,
    elapsedMs: Math.round(elapsed),
    filesConsidered: total,
    scanned: Atomics.load(shared, 4),
    filesWithMatches: Atomics.load(shared, 3),
    matchingLines: Atomics.load(shared, 2),
    skippedLarge: Atomics.load(shared, 5),
    skippedBinary: Atomics.load(shared, 6),
    firstFile: found[0] ?? null,
    foundInIgnored: found.some((p) => p.includes('node_modules/') || p.startsWith('dist/') || p.startsWith('build/')),
    mainLoopLagMaxMs: ms(h.max / 1e6)
  }
}
out.contentSearch = {
  common: await contentSearch('function', false),
  rareIgnoredOff: await contentSearch(needle, false),
  rareIgnoredOn: await contentSearch(needle, true)
}
await built.worker.terminate()

// ---------- 5. memory and in-thread timing (same code, no worker) ----------
{
  gc()
  const before = process.memoryUsage()
  const h = monitorEventLoopDelay({ resolution: 5 })
  const core = new IndexerCore(root, () => undefined)
  const t0 = performance.now()
  h.enable()
  await core.start()
  const dt = performance.now() - t0
  h.disable()
  gc()
  const after = process.memoryUsage()
  const st = core.status()
  out.inThread = {
    note: 'the engine run on the main thread of this process; the app runs it in a worker',
    completeAfterMs: Math.round(dt),
    entries: st.files + st.dirs,
    heapUsedDeltaMB: mb(after.heapUsed - before.heapUsed),
    rssDeltaMB: mb(after.rss - before.rss),
    bytesPerEntry: Math.round((after.heapUsed - before.heapUsed) / Math.max(1, st.files + st.dirs)),
    loopLagMaxMs: ms(h.max / 1e6),
    loopLagP99Ms: ms(h.percentile(99) / 1e6),
    gcExposed: typeof globalThis.gc === 'function'
  }
  // the burst of watch events a big git checkout produces
  const ev = Array.from({ length: 1000 }, (_, i) => ({ type: 'add', relPath: `bench-added/f${i}.ts` }))
  const t1 = performance.now()
  core.applyWatch(ev)
  out.inThread.applyWatch1000Ms = ms(performance.now() - t1)
  core.dispose()
}

if (flag('json')) console.log(JSON.stringify(out, null, 2))
else console.dir(out, { depth: 5 })

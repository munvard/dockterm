'use strict'
// DockTerm usage capture (auto-generated copy lives in DockTerm's userData dir).
//
// Claude Code runs this as the `statusLine` command of the DockTerm-owned
// settings file passed with `claude --settings <file>`. It receives the session
// JSON on stdin (the same JSON the user's own status line gets), and does two
// things:
//   1. saves rate_limits (5-hour and 7-day use + reset times), context, model
//      and cost to claude-usage.json next to this script (atomic write);
//   2. runs the user's own status line command with the same stdin and passes its
//      output through untouched, so the status line looks exactly as before.
// No network, no tokens, no dependencies: plain Node, any OS. It never throws.

var fs = require('fs')
var path = require('path')
var os = require('os')
var childProcess = require('child_process')

var FORMAT = 1
var OUT_NAME = 'claude-usage.json'

function isNum(v) {
  return typeof v === 'number' && isFinite(v)
}

/** One rate-limit window from Claude's JSON, or null when absent, malformed or
 * already past its reset time (Claude drops such windows itself). */
function toWindow(w, nowSec) {
  if (!w || typeof w !== 'object') return null
  var pct = w.used_percentage
  var at = w.resets_at
  if (!isNum(pct) || !isNum(at)) return null
  if (at > 1e11) at = Math.floor(at / 1000)
  if (at <= nowSec) return null
  return { pct: pct < 0 ? 0 : pct, resetsAt: at }
}

/** Pull what DockTerm needs out of the status line JSON text. Returns null when
 * the text is not a JSON object. Absent parts come back as null, never invented. */
function extract(text, nowMs) {
  var d
  try {
    d = JSON.parse(text)
  } catch (e) {
    return null
  }
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  var nowSec = nowMs / 1000
  var rl = d.rate_limits && typeof d.rate_limits === 'object' ? d.rate_limits : {}
  var cw = d.context_window && typeof d.context_window === 'object' ? d.context_window : null
  var m = d.model && typeof d.model === 'object' ? d.model : null
  var cost = d.cost && typeof d.cost === 'object' ? d.cost : null
  var ws = d.workspace && typeof d.workspace === 'object' ? d.workspace : {}
  return {
    sessionId: typeof d.session_id === 'string' ? d.session_id : null,
    fiveHour: toWindow(rl.five_hour, nowSec),
    sevenDay: toWindow(rl.seven_day, nowSec),
    contextPct: cw && isNum(cw.used_percentage) ? cw.used_percentage : null,
    contextSize: cw && isNum(cw.context_window_size) ? cw.context_window_size : null,
    model: m
      ? {
          id: typeof m.id === 'string' ? m.id : null,
          name: typeof m.display_name === 'string' ? m.display_name : null
        }
      : null,
    costUsd: cost && isNum(cost.total_cost_usd) ? cost.total_cost_usd : null,
    projectDir:
      typeof ws.project_dir === 'string'
        ? ws.project_dir
        : typeof d.cwd === 'string'
          ? d.cwd
          : null
  }
}

function validWindow(w, nowSec) {
  return w && isNum(w.pct) && isNum(w.resetsAt) && w.resetsAt > nowSec ? w : null
}

/** The window to keep. A later reset time is a newer window and wins; within the
 * same window usage only grows, so the higher percentage wins. This stops an idle
 * session that still re-sends old numbers from rolling the account's usage back. */
function pickWindow(prev, cur) {
  if (!prev) return cur
  if (!cur) return prev
  if (cur.resetsAt > prev.resetsAt) return cur
  if (cur.resetsAt < prev.resetsAt) return prev
  return cur.pct >= prev.pct ? cur : prev
}

/** Fold one captured payload into the previously saved record. */
function merge(prev, cur, nowMs) {
  var nowSec = nowMs / 1000
  var p = prev && prev.v === FORMAT ? prev : null
  var fiveHour = pickWindow(p && validWindow(p.fiveHour, nowSec), cur.fiveHour)
  var sevenDay = pickWindow(p && validWindow(p.sevenDay, nowSec), cur.sevenDay)
  var gotLimits = !!(cur.fiveHour || cur.sevenDay)
  var session = {
    sessionId: cur.sessionId,
    context: cur.contextPct !== null ? { pct: cur.contextPct, size: cur.contextSize } : null,
    model: cur.model,
    costUsd: cur.costUsd
  }
  // A payload without a model is not a real session snapshot: keep the old one.
  if (!cur.model && p) {
    session = { sessionId: p.sessionId || null, context: p.context || null, model: p.model || null, costUsd: isNum(p.costUsd) ? p.costUsd : null }
  }
  return {
    v: FORMAT,
    updatedAt: nowMs,
    limitsAt: gotLimits ? nowMs : p && isNum(p.limitsAt) ? p.limitsAt : null,
    fiveHour: fiveHour,
    sevenDay: sevenDay,
    sessionId: session.sessionId,
    context: session.context,
    model: session.model,
    costUsd: session.costUsd
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e) {
    return null
  }
}

function writeAtomic(file, text) {
  var tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, text)
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    // Windows can refuse to replace a file another process has open.
    try {
      fs.writeFileSync(file, text)
    } finally {
      try {
        fs.unlinkSync(tmp)
      } catch (e2) {
        /* already gone */
      }
    }
  }
}

function statusLineOf(settings) {
  if (!settings || typeof settings !== 'object' || !('statusLine' in settings)) return undefined
  var s = settings.statusLine
  if (s && typeof s === 'object' && s.type === 'command' && typeof s.command === 'string' && s.command.trim()) {
    return { command: s.command }
  }
  return null // present but not a usable command: the user has no status line here
}

/** The user's effective status line command: local project settings, then project
 * settings, then user settings (CLAUDE_CONFIG_DIR or ~/.claude). Null when none.
 * Managed (policy) settings are not read: when they define one they override the
 * DockTerm settings file and this script is not run at all. */
function resolveDelegate(projectDir, configDir, read) {
  var files = []
  if (projectDir) {
    files.push(path.join(projectDir, '.claude', 'settings.local.json'))
    files.push(path.join(projectDir, '.claude', 'settings.json'))
  }
  files.push(path.join(configDir, 'settings.json'))
  for (var i = 0; i < files.length; i++) {
    var sl = statusLineOf(read(files[i]))
    if (sl === undefined) continue
    if (sl === null) return null
    if (/usage-capture/.test(sl.command)) return null // never run ourselves
    return sl.command
  }
  return null
}

function findGitBash(env, exists) {
  var cands = []
  if (env.CLAUDE_CODE_GIT_BASH_PATH) cands.push(env.CLAUDE_CODE_GIT_BASH_PATH)
  var roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432]
  for (var i = 0; i < roots.length; i++) if (roots[i]) cands.push(roots[i] + '\\Git\\bin\\bash.exe')
  if (env.LOCALAPPDATA) cands.push(env.LOCALAPPDATA + '\\Programs\\Git\\bin\\bash.exe')
  for (var j = 0; j < cands.length; j++) if (exists(cands[j])) return cands[j]
  return null
}

/** How to run the user's status line command: the way Claude Code itself does
 * (Git Bash on Windows when installed, else PowerShell; sh elsewhere). */
function delegateInvocation(command, platform, env, exists) {
  if (platform === 'win32') {
    var bash = findGitBash(env, exists)
    if (bash) return { file: bash, args: ['-c', command] }
    return { file: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', command] }
  }
  return { file: '/bin/sh', args: ['-c', command] }
}

function configDirOf(env) {
  var o = env.CLAUDE_CONFIG_DIR && env.CLAUDE_CONFIG_DIR.trim()
  return o || path.join(os.homedir(), '.claude')
}

function capture(text, outFile, nowMs) {
  var cur = extract(text, nowMs)
  if (!cur) return null
  var next = merge(readJson(outFile), cur, nowMs)
  writeAtomic(outFile, JSON.stringify(next) + '\n')
  return cur
}

function run(text) {
  var env = process.env
  var outFile = env.DOCKTERM_USAGE_FILE || path.join(__dirname, OUT_NAME)
  var parsed = null
  try {
    parsed = capture(text, outFile, Date.now())
  } catch (e) {
    /* capturing must never break the status line */
  }
  var projectDir = parsed ? parsed.projectDir : null
  var command = null
  try {
    command = resolveDelegate(projectDir, configDirOf(env), readJson)
  } catch (e) {
    command = null
  }
  if (!command) process.exit(0)
  var inv = delegateInvocation(command, process.platform, env, fs.existsSync)
  var childEnv = {}
  for (var k in env) childEnv[k] = env[k]
  childEnv.DOCKTERM_USAGE_CAPTURE = '1'
  var child = childProcess.spawn(inv.file, inv.args, {
    stdio: ['pipe', 'inherit', 'inherit'],
    env: childEnv,
    windowsHide: true
  })
  child.on('error', function () {
    process.exit(0)
  })
  child.on('exit', function (code) {
    process.exit(code === null ? 0 : code)
  })
  child.stdin.on('error', function () {})
  child.stdin.end(text)
  // Claude cancels a status line run that a newer update supersedes.
  process.on('SIGTERM', function () {
    try {
      child.kill()
    } catch (e) {
      /* gone */
    }
    process.exit(143)
  })
}

function main() {
  if (process.stdin.isTTY) process.exit(0)
  var chunks = []
  process.stdin.on('data', function (c) {
    chunks.push(c)
  })
  process.stdin.on('end', function () {
    run(Buffer.concat(chunks).toString('utf8'))
  })
  process.stdin.on('error', function () {
    process.exit(0)
  })
}

module.exports = {
  FORMAT: FORMAT,
  OUT_NAME: OUT_NAME,
  extract: extract,
  merge: merge,
  pickWindow: pickWindow,
  resolveDelegate: resolveDelegate,
  delegateInvocation: delegateInvocation,
  capture: capture
}

if (require.main === module) main()

import { realpathSync, lstatSync, readlinkSync, type Stats } from 'node:fs'
import { basename, dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

export class JailViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JailViolation'
  }
}

/**
 * Resolves `relPath` (relative to `root`) to an absolute path guaranteed to stay
 * inside `root`, even across symlinks. Throws {@link JailViolation} otherwise.
 *
 * Steps:
 *  1. Canonicalize the root (realpath, symlink-free).
 *  2. Resolve the candidate against the canonical root.
 *  3. Canonicalize the nearest *existing* ancestor of the candidate, then
 *     re-attach the not-yet-existing tail — so a symlink partway down the path
 *     cannot smuggle the target outside the root.
 *  4. Containment check via path.relative, case-insensitive on Windows.
 */
export function resolveInside(root: string, relPath: string): string {
  const canonicalRoot = canonicalize(resolve(root))
  // Not normalized here: `link/..` must be walked by the resolver, not folded away.
  const candidate = isAbsolute(relPath) ? relPath : `${canonicalRoot}${sep}${relPath}`
  const real = realpathNearest(candidate)
  if (!isInside(canonicalRoot, real)) {
    throw new JailViolation(`Path escapes project root: ${relPath}`)
  }
  return real
}

/** True if `child` is `root` itself or nested within it. */
export function isInside(root: string, child: string): boolean {
  const rel = relative(normalizeCase(root), normalizeCase(child))
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** True if `path` exists and is a regular file, with no symlink, FIFO, device,
 * or socket at that exact spot. Callers use this before reading/writing a file
 * that was reached by walking a (jailed) directory tree, so a crafted entry
 * can't trigger a symlink-followed read/hang-on-FIFO. */
export function isRegularFile(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

function canonicalize(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

function tryLstat(p: string): Stats | null {
  try {
    return lstatSync(p)
  } catch {
    return null
  }
}

function realpathSyncSafe(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    return p
  }
}

const SEPARATORS = process.platform === 'win32' ? /[\\/]+/ : /\/+/
const MAX_LINK_HOPS = 40

/**
 * Resolves `input` component by component, following every symlink on the way
 * (including dangling ones, and links met in the middle of the path or inside
 * another link's target) and stopping the lexical walk only at components that
 * do not exist. Node's own `realpathSync` throws the instant any link cannot be
 * followed, which is exactly the case an attacker needs: `bridge -> /outside`
 * plus `leaf -> bridge/new-file` names a target that does not exist yet, so it
 * looks "inside" lexically while `fs.writeFile` follows `bridge` out of the
 * jail. Walking with `lstat`/`readlink` resolves the existing ancestors of a
 * missing target too. One hop budget is shared by the whole walk.
 */
function resolveThroughLinks(input: string): string {
  const root = parse(input).root
  const queue = input.slice(root.length).split(SEPARATORS).filter(Boolean)
  let cur = root
  let hops = 0
  while (queue.length) {
    const comp = queue.shift() as string
    if (comp === '.') continue
    if (comp === '..') {
      cur = dirname(cur)
      continue
    }
    const next = join(cur, comp)
    const st = tryLstat(next)
    if (st?.isSymbolicLink()) {
      if (++hops > MAX_LINK_HOPS) throw new JailViolation('Too many levels of symbolic links')
      const link = readlinkSync(next)
      const linkRoot = parse(link).root
      if (isAbsolute(link)) cur = linkRoot
      queue.unshift(...link.slice(isAbsolute(link) ? linkRoot.length : 0).split(SEPARATORS).filter(Boolean))
      continue
    }
    cur = next
  }
  return cur
}

/** Canonical (case-normalized) form of the nearest existing ancestor of the
 * symlink-free `walked` path, with the not-yet-existing tail re-attached. */
function realpathNearest(target: string): string {
  const walked = resolveThroughLinks(target)
  let existing = walked
  const tail: string[] = []
  for (;;) {
    if (tryLstat(existing)) {
      const real = realpathSyncSafe(existing)
      return tail.length ? resolve(real, ...tail.reverse()) : real
    }
    const parent = resolve(existing, '..')
    if (parent === existing) return walked // reached a non-existent root
    tail.push(basename(existing))
    existing = parent
  }
}

function normalizeCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

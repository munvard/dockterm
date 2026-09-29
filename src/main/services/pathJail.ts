import { realpathSync, lstatSync, readlinkSync, type Stats } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

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
  const candidate = isAbsolute(relPath) ? resolve(relPath) : resolve(canonicalRoot, relPath)
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

/**
 * Fully resolves `path` through a symlink chain, even a *dangling* one whose
 * final target doesn't exist. Node's own `realpathSync` throws the instant any
 * link in the chain can't be followed, which is exactly the case an attacker
 * needs: a symlink whose target is missing (or not yet created) resolves as
 * "doesn't exist" instead of "points outside the root", letting a mutation
 * that creates-on-write (like `fs.writeFile`) follow it straight through.
 * Walking the chain ourselves with `lstat`/`readlink` finds where it ACTUALLY
 * points regardless of whether that target exists yet.
 */
function resolveSymlinkChain(path: string, depth = 0): string {
  if (depth > 40) throw new JailViolation('Too many levels of symbolic links')
  const st = tryLstat(path)
  if (!st) return path // nothing at this path at all
  if (!st.isSymbolicLink()) return realpathSyncSafe(path)
  const link = readlinkSync(path)
  const target = isAbsolute(link) ? link : resolve(dirname(path), link)
  return resolveSymlinkChain(target, depth + 1)
}

function realpathNearest(target: string): string {
  let existing = target
  const tail: string[] = []
  for (;;) {
    const st = tryLstat(existing)
    if (st) {
      const real = st.isSymbolicLink() ? resolveSymlinkChain(existing) : realpathSyncSafe(existing)
      return tail.length ? resolve(real, ...tail.reverse()) : real
    }
    const parent = resolve(existing, '..')
    if (parent === existing) return target // reached a non-existent root
    tail.push(basename(existing))
    existing = parent
  }
}

function normalizeCase(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

/**
 * Pure text building for the chat composer: how attachments and pasted-text
 * chips turn into the bytes Claude Code gets. No DOM, no stores, so the exact
 * rules (order, quoting, Windows paths, placeholder expansion) are unit-tested.
 * See .claude/work/briefs/2026-09-29-composer-spec.md (Send algorithm).
 */

export type ComposerPlatform = 'darwin' | 'win32' | 'linux'

export interface Attachment {
  id: string
  kind: 'image' | 'file' | 'dir'
  /** Absolute path on disk. */
  path: string
  name: string
  /** Object URL / data URL for an image thumbnail, when we have one. */
  thumb?: string
}

export interface PastedChip {
  id: number
  text: string
}

export const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)$/i

export function isImagePath(p: string): boolean {
  return IMAGE_EXT_RE.test(p)
}

export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** Forward slashes on Windows (Claude strips single backslashes as shell escapes). */
function toClaudePath(p: string, platform: ComposerPlatform): string {
  return platform === 'win32' ? p.replace(/\\/g, '/') : p
}

function quoteIfSpaces(p: string): string {
  return /\s/.test(p) ? `"${p.replace(/"/g, '')}"` : p
}

/** One absolute path as Claude's paste handler wants it. */
export function formatPathForClaude(p: string, platform: ComposerPlatform): string {
  return quoteIfSpaces(toClaudePath(p, platform))
}

/**
 * The image paths as ONE paste payload. Joined by newline inside a bracketed
 * paste; without bracketed paste a newline would submit, so join by spaces.
 */
export function buildImagePaste(paths: string[], platform: ComposerPlatform, bracketed: boolean): string {
  return paths.map((p) => formatPathForClaude(p, platform)).join(bracketed ? '\n' : ' ')
}

/** `abs` relative to `root` when it lies inside it (forward slashes), else null. */
export function relativeInside(root: string | null, abs: string, platform: ComposerPlatform): string | null {
  if (!root) return null
  const win = platform === 'win32'
  const norm = (s: string): string => {
    let out = win ? s.replace(/\\/g, '/') : s
    while (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1)
    return out
  }
  const r = norm(root)
  const a = norm(abs)
  const cmpR = win ? r.toLowerCase() : r
  const cmpA = win ? a.toLowerCase() : a
  if (cmpA === cmpR) return null
  const prefix = cmpR.endsWith('/') ? cmpR : cmpR + '/'
  if (!cmpA.startsWith(prefix)) return null
  const rel = a.slice(prefix.length)
  return rel.length > 0 ? rel : null
}

/** `@relative/path` inside the pane root, else the absolute path (quoted if it has spaces). */
export function fileRef(absPath: string, root: string | null, platform: ComposerPlatform): string {
  const rel = relativeInside(root, absPath, platform)
  if (rel !== null) return /\s/.test(rel) ? `@"${rel.replace(/"/g, '')}"` : `@${rel}`
  return formatPathForClaude(absPath, platform)
}

export function pastedToken(id: number): string {
  return `[Pasted text #${id}]`
}

/** Replace every `[Pasted text #N]` token with its text (a function replacer, so `$&` in the text stays literal). */
export function expandPasted(text: string, chips: PastedChip[]): string {
  if (chips.length === 0) return text
  const byToken = new Map(chips.map((c) => [pastedToken(c.id), c.text]))
  return text.replace(/\[Pasted text #\d+\]/g, (m) => byToken.get(m) ?? m)
}

/** Chips whose token is still present in the text (a deleted token drops its chip). */
export function liveChips(text: string, chips: PastedChip[]): PastedChip[] {
  return chips.filter((c) => text.includes(pastedToken(c.id)))
}

export interface BuildInput {
  text: string
  chips: PastedChip[]
  files: Attachment[]
  root: string | null
  platform: ComposerPlatform
  /** Images were pasted into Claude just before this text. */
  hadImages: boolean
}

/**
 * The text half of a send: typed text with pasted chips expanded in place, file
 * and folder chips appended as references on their own line, and a leading
 * space when images went first (Claude inserts `[Image #N]` with no trailing space).
 */
export function buildPromptText(input: BuildInput): string {
  const typed = expandPasted(input.text, input.chips).trim()
  const refs = input.files.map((f) => fileRef(f.path, input.root, input.platform)).join(' ')
  const body = typed && refs ? `${typed}\n${refs}` : typed || refs
  return input.hadImages ? ` ${body}` : body
}

/** How many `[Image #` markers the pane's visible text shows. */
export function countImageMarkers(visible: string): number {
  return (visible.match(/\[Image #/g) ?? []).length
}

/** A dropped or attached path made absolute against `root` when it is relative. */
export function absolutize(root: string | null, p: string, platform: ComposerPlatform): string {
  const isAbs = platform === 'win32' ? /^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p) : p.startsWith('/')
  if (isAbs || !root) return p
  const sep = platform === 'win32' ? '\\' : '/'
  return root.replace(/[\\/]+$/, '') + sep + p.replace(/^\.?[\\/]/, '')
}

export type PasteImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
const PASTE_MIMES: readonly string[] = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export function toComposerPlatform(p: string): ComposerPlatform {
  return p === 'win32' ? 'win32' : p === 'darwin' ? 'darwin' : 'linux'
}

/** The pasteable image type when the clipboard holds NO text, else null. */
export function pickImageMime(
  text: string,
  files: readonly { type: string }[]
): PasteImageMime | null {
  if (text.length > 0) return null
  const hit = files.find((f) => PASTE_MIMES.includes(f.type))
  return hit ? (hit.type as PasteImageMime) : null
}


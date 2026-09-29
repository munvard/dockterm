import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Pure parsers for file lists on the system clipboard (no electron import). */

/** `file://` URLs, one per line (text/uri-list, gnome copied-files, public.file-url). */
export function parseUriList(text: string): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\0/g, '').trim()
    if (!/^file:\/\//i.test(line)) continue
    try {
      out.push(fileURLToPath(line))
    } catch {
      // malformed URL
    }
  }
  return out
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/** macOS NSFilenamesPboardType: an XML plist array of <string> paths. */
export function parseNSFilenames(xml: string): string[] {
  const out: string[] = []
  const re = /<string>([\s\S]*?)<\/string>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml))) out.push(unescapeXml(m[1]))
  return out
}

/** Windows FileNameW: UTF-16LE, NUL terminated (a list is separated by NULs, ended by two). */
export function parseFileNameW(buf: Uint8Array): string[] {
  const text = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength).toString('utf16le')
  return text.split('\0').filter((p) => p.length > 0)
}

/** Keep unique, absolute, existing paths only. Never touches file contents. */
export function keepExistingAbsolute(paths: string[], exists: (p: string) => boolean = existsSync): string[] {
  const seen = new Set<string>()
  for (const p of paths) {
    if (!p || !isAbsolute(p) || seen.has(p)) continue
    let ok = false
    try {
      ok = exists(p)
    } catch {
      ok = false
    }
    if (ok) seen.add(p)
  }
  return [...seen]
}

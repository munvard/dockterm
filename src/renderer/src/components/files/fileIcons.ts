import type { LucideIcon } from 'lucide-react'
import {
  Braces,
  Database,
  File as FileIcon,
  FileArchive,
  FileAudio,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileSpreadsheet,
  FileTerminal,
  FileText,
  FileType,
  FileVideo,
  Folder,
  FolderGit2,
  FolderOpen,
  Package
} from 'lucide-react'

export type IconTone = 'dir' | 'code' | 'data' | 'doc' | 'media' | 'config' | 'shell' | 'lock' | 'plain'

export interface FileIconSpec {
  Icon: LucideIcon
  tone: IconTone
}

const BY_EXT: Record<string, FileIconSpec> = {}
const add = (exts: string, spec: FileIconSpec): void => {
  for (const e of exts.split(' ')) BY_EXT[e] = spec
}

add('ts tsx js jsx mjs cjs py rb go rs java kt swift c h cpp hpp cc cs php lua dart scala vue svelte sql css scss sass less html htm xml', {
  Icon: FileCode,
  tone: 'code'
})
add('json jsonc json5', { Icon: FileJson, tone: 'data' })
add('yml yaml toml ini env conf cfg properties', { Icon: FileCog, tone: 'config' })
add('md mdx txt rst log', { Icon: FileText, tone: 'doc' })
add('png jpg jpeg gif webp svg ico bmp avif heic', { Icon: FileImage, tone: 'media' })
add('mp4 mov webm mkv avi', { Icon: FileVideo, tone: 'media' })
add('mp3 wav ogg flac m4a', { Icon: FileAudio, tone: 'media' })
add('zip tar gz tgz bz2 xz 7z rar', { Icon: FileArchive, tone: 'data' })
add('sh bash zsh fish ps1 bat cmd', { Icon: FileTerminal, tone: 'shell' })
add('csv tsv xlsx xls', { Icon: FileSpreadsheet, tone: 'data' })
add('ttf otf woff woff2', { Icon: FileType, tone: 'plain' })
add('db sqlite sqlite3', { Icon: Database, tone: 'data' })
add('lock', { Icon: FileLock, tone: 'lock' })

const BY_NAME: Record<string, FileIconSpec> = {
  'package.json': { Icon: Package, tone: 'data' },
  'tsconfig.json': { Icon: Braces, tone: 'config' },
  dockerfile: { Icon: FileCog, tone: 'config' },
  makefile: { Icon: FileTerminal, tone: 'shell' },
  '.gitignore': { Icon: FileCog, tone: 'config' },
  '.env': { Icon: FileLock, tone: 'lock' },
  license: { Icon: FileText, tone: 'doc' },
  readme: { Icon: FileText, tone: 'doc' }
}

const PLAIN: FileIconSpec = { Icon: FileIcon, tone: 'plain' }

export function iconFor(name: string, isDir: boolean, open = false): FileIconSpec {
  if (isDir) {
    if (name === '.git') return { Icon: FolderGit2, tone: 'dir' }
    return { Icon: open ? FolderOpen : Folder, tone: 'dir' }
  }
  const lower = name.toLowerCase()
  const named = BY_NAME[lower]
  if (named) return named
  if (lower.startsWith('.env')) return BY_NAME['.env']
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return BY_NAME[lower.replace(/\..*$/, '')] ?? PLAIN
  return BY_EXT[lower.slice(dot + 1)] ?? PLAIN
}

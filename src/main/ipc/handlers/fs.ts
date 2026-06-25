import { z } from 'zod'
import { nativeImage } from 'electron'
import { ok, err, type Err } from '@shared/result'
import { JailViolation, resolveInside } from '../../services/pathJail'
import { rootFor } from '../../services/activeRoot'
import {
  readTree,
  searchTree,
  readFile,
  writeFile,
  createFile,
  createDir,
  rename,
  trash,
  reveal,
  readDataUrl,
  openPath
} from '../../services/fileService'
import { MAX_EDIT_FILE_BYTES } from '@shared/constants'
import type { Registrar } from '../register'

const relSchema = z.object({ relPath: z.string().min(1).max(4096) })
const treeSchema = z.object({ relPath: z.string().max(4096) })
const searchSchema = z.object({ query: z.string().max(200) })
const writeSchema = z.object({
  relPath: z.string().min(1).max(4096),
  content: z.string().max(Math.ceil(MAX_EDIT_FILE_BYTES * 1.2)),
  expectedMtimeMs: z.number().nullable()
})
const renameSchema = z.object({
  fromRelPath: z.string().min(1).max(4096),
  toRelPath: z.string().min(1).max(4096)
})
const dragSchema = z.object({ relPaths: z.array(z.string().min(1).max(4096)).min(1).max(50) })

// A non-empty 1×1 transparent icon — Electron's startDrag requires a non-empty
// icon; the OS shows its own file/badge image while dragging, so this stays out
// of the way. On macOS we prefer the system multi-documents glyph.
const DRAG_ICON = (() => {
  if (process.platform === 'darwin') {
    try {
      const sys = nativeImage.createFromNamedImage('NSImageNameMultipleDocuments', [0, 0, 0, 1])
      if (!sys.isEmpty()) return sys
    } catch {
      // fall through to the embedded transparent pixel
    }
  }
  return nativeImage.createFromDataURL(
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  )
})()

function fail(e: unknown): Err {
  if (e instanceof JailViolation) return err('JAIL_VIOLATION', e.message)
  const code = (e as NodeJS.ErrnoException | undefined)?.code
  if (code === 'ENOENT') return err('NOT_FOUND', 'File or folder not found')
  if (code === 'EEXIST') return err('EXISTS', 'A file or folder with that name already exists')
  return err('IO', e instanceof Error ? e.message : 'Filesystem error')
}

export function registerFsHandlers(reg: Registrar): void {
  reg('fs:readTree', treeSchema, async (req, event) => {
    try {
      return ok(await readTree(rootFor(event), req.relPath))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:search', searchSchema, async (req, event) => {
    try {
      return ok(await searchTree(rootFor(event), req.query))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:readFile', relSchema, async (req, event) => {
    try {
      return ok(await readFile(rootFor(event), req.relPath))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:writeFile', writeSchema, async (req, event) => {
    try {
      return ok(await writeFile(rootFor(event), req.relPath, req.content, req.expectedMtimeMs))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:createFile', relSchema, async (req, event) => {
    try {
      await createFile(rootFor(event), req.relPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:createDir', relSchema, async (req, event) => {
    try {
      await createDir(rootFor(event), req.relPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:rename', renameSchema, async (req, event) => {
    try {
      await rename(rootFor(event), req.fromRelPath, req.toRelPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:delete', relSchema, async (req, event) => {
    try {
      await trash(rootFor(event), req.relPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:reveal', relSchema, (req, event) => {
    try {
      reveal(rootFor(event), req.relPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:readDataUrl', relSchema, async (req, event) => {
    try {
      return ok(await readDataUrl(rootFor(event), req.relPath))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:openPath', relSchema, async (req, event) => {
    try {
      await openPath(rootFor(event), req.relPath)
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })

  // Start a native OS drag of real files. Each path is jailed to the project root
  // (rejects anything outside, symlink-safe) before the drag begins.
  reg('fs:startDrag', dragSchema, (req, event) => {
    try {
      const root = rootFor(event)
      const files = req.relPaths.map((rel) => resolveInside(root, rel))
      event.sender.startDrag({ file: files[0], files, icon: DRAG_ICON })
      return ok(undefined)
    } catch (e) {
      return fail(e)
    }
  })
}

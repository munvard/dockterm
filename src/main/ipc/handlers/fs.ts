import { z } from 'zod'
import { nativeImage, type IpcMainInvokeEvent } from 'electron'
import { ok, err, type Err } from '@shared/result'
import { JailViolation, resolveInside } from '../../services/pathJail'
import { rootFor, rememberKnownRoot, isKnownRoot } from '../../services/activeRoot'
import {
  readTree,
  readDir,
  duplicate,
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
import { indexReady, indexStatus, quickSearch } from '../../search/searchService'
import type { Registrar } from '../register'

const relSchema = z.object({ relPath: z.string().min(1).max(4096) })
const treeSchema = z.object({ relPath: z.string().max(4096) })
const searchSchema = z.object({ query: z.string().max(200) })
const dirSchema = z.object({ relPath: z.string().max(4096), showIgnored: z.boolean() })
// readFile/writeFile accept an optional absolute `root`, for an editor tab
// whose owning pane is no longer the window's focused one (see RU-C3): it's
// validated against the window's known roots below, never trusted outright.
const readSchema = z.object({ relPath: z.string().min(1).max(4096), root: z.string().max(4096).optional() })
const writeSchema = z.object({
  relPath: z.string().min(1).max(4096),
  content: z.string().max(Math.ceil(MAX_EDIT_FILE_BYTES * 1.2)),
  expectedMtimeMs: z.number().nullable(),
  root: z.string().max(4096).optional()
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

/** The active root, remembered as known for this window, then overridden by
 * `explicitRoot` when the caller passed one AND it's a root this window has
 * genuinely had active before (never an arbitrary path from the renderer). */
function resolveRoot(event: IpcMainInvokeEvent, explicitRoot?: string): string {
  const active = rootFor(event)
  rememberKnownRoot(event.sender.id, active)
  if (explicitRoot && explicitRoot !== active && isKnownRoot(event.sender.id, explicitRoot)) {
    return explicitRoot
  }
  return active
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
      const root = rootFor(event)
      // Backed by the worker index once it is built (also starts building it);
      // until then, or when the folder is too broad to index, the old walk answers.
      indexStatus(root, event.sender)
      if (indexReady(root) && req.query.trim()) {
        const res = await quickSearch(root, event.sender, {
          query: req.query,
          includeIgnored: false,
          kinds: 'both',
          limit: 200,
          recent: [],
          owner: 999
        })
        if (res.kind === 'ok') {
          return ok(
            res.results.hits.map((h) => ({
              name: h.relPath.slice(h.relPath.lastIndexOf('/') + 1),
              relPath: h.relPath,
              type: h.isDir ? ('dir' as const) : ('file' as const)
            }))
          )
        }
      }
      return ok(await searchTree(root, req.query))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:readDir', dirSchema, async (req, event) => {
    try {
      return ok(await readDir(rootFor(event), req.relPath, req.showIgnored))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:duplicate', relSchema, async (req, event) => {
    try {
      return ok({ relPath: await duplicate(rootFor(event), req.relPath) })
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:readFile', readSchema, async (req, event) => {
    try {
      return ok(await readFile(resolveRoot(event, req.root), req.relPath))
    } catch (e) {
      return fail(e)
    }
  })

  reg('fs:writeFile', writeSchema, async (req, event) => {
    try {
      const root = resolveRoot(event, req.root)
      return ok(await writeFile(root, req.relPath, req.content, req.expectedMtimeMs))
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

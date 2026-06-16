import { z } from 'zod'
import { ok, err, type Err } from '@shared/result'
import { JailViolation } from '../../services/pathJail'
import { rootFor } from '../../services/activeRoot'
import {
  readTree,
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
const writeSchema = z.object({
  relPath: z.string().min(1).max(4096),
  content: z.string().max(Math.ceil(MAX_EDIT_FILE_BYTES * 1.2)),
  expectedMtimeMs: z.number().nullable()
})
const renameSchema = z.object({
  fromRelPath: z.string().min(1).max(4096),
  toRelPath: z.string().min(1).max(4096)
})

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
}

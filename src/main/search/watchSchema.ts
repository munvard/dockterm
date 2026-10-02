import { z } from 'zod'
import { isSafeRelPath } from '@shared/search/relPath'

export const watchSchema = z.object({
  events: z
    .array(
      z.object({
        type: z.enum(['add', 'change', 'unlink', 'addDir', 'unlinkDir']),
        relPath: z.string().max(4096).refine(isSafeRelPath, 'Path must be relative to the project')
      })
    )
    .max(20000)
})

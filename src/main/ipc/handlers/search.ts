import { z } from 'zod'
import { ok, err } from '@shared/result'
import { rootFor } from '../../services/activeRoot'
import {
  applyWatch,
  cancelContent,
  indexStatus,
  quickSearch,
  refreshIndex,
  startContent
} from '../../search/searchService'
import { watchSchema } from '../../search/watchSchema'
import type { Registrar } from '../register'

const quickSchema = z.object({
  query: z.string().max(400),
  includeIgnored: z.boolean(),
  kinds: z.enum(['files', 'both']),
  limit: z.number().int().min(1).max(500),
  recent: z.array(z.string().max(4096)).max(100),
  owner: z.number().int().min(0).max(1000)
})

const contentSchema = z.object({
  query: z.string().min(1).max(500),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  regex: z.boolean(),
  include: z.string().max(500),
  exclude: z.string().max(500),
  includeIgnored: z.boolean()
})

const noArgs = z.void().or(z.undefined()).or(z.null())

export function registerSearchHandlers(reg: Registrar): void {
  reg('search:files', quickSchema, async (req, event) => {
    const res = await quickSearch(rootFor(event), event.sender, req)
    if (res.kind === 'ok') return ok({ stale: false, results: res.results, index: res.status })
    const empty = { hits: [], total: 0, line: null, col: null }
    if (res.kind === 'stale') {
      return ok({ stale: true, results: empty, index: indexStatus(rootFor(event), event.sender) })
    }
    return ok({ stale: false, results: empty, index: res.status })
  })

  reg('search:status', noArgs, (_req, event) => ok(indexStatus(rootFor(event), event.sender)))

  reg('search:content', contentSchema, (req, event) => {
    const res = startContent(rootFor(event), event.sender, req)
    return 'error' in res ? err('VALIDATION', res.error) : ok(res)
  })

  reg('search:cancel', noArgs, (_req, event) => {
    cancelContent(event.sender.id)
    return ok(undefined)
  })

  reg('search:applyWatch', watchSchema, (req, event) => {
    applyWatch(rootFor(event), req.events)
    return ok(undefined)
  })

  reg('search:refresh', noArgs, (_req, event) => {
    refreshIndex(rootFor(event))
    return ok(undefined)
  })
}

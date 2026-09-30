import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import { claudeConfigDir, claudeJsonPath } from './claudeConfigDir'

// readPlanTier used to re-read and re-parse two JSON config files on every
// broadcast() call (every scan tick that saw new bytes, i.e. roughly every 5s
// while Claude is active) even though the rate-limit tier almost never
// changes. Cached by (mtime, size) of BOTH files it can read: the tier may come
// from the credentials fallback, so a login or plan change there must invalidate
// it too.
let planTierCache: { key: string; tier: string | null } | null = null

async function fileSignature(p: string): Promise<string> {
  try {
    const st = await stat(p)
    return `${st.mtimeMs}:${st.size}`
  } catch {
    return 'missing'
  }
}

/** The user's Claude plan tier, read (asynchronously) from local config (null if not found). */
export async function readPlanTier(): Promise<string | null> {
  const path = claudeJsonPath()
  const credsPath = join(claudeConfigDir(), '.credentials.json')
  const key = `${await fileSignature(path)}|${await fileSignature(credsPath)}`
  if (planTierCache && planTierCache.key === key) return planTierCache.tier
  const tryJson = async (p: string): Promise<Record<string, unknown> | null> => {
    try {
      return JSON.parse(await readFile(p, 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }
  const cfg = await tryJson(path)
  const acct = cfg?.oauthAccount as
    | { organizationRateLimitTier?: string; userRateLimitTier?: string }
    | undefined
  let tier = acct?.userRateLimitTier ?? acct?.organizationRateLimitTier ?? null
  if (!tier) {
    const creds = await tryJson(credsPath)
    const oauth = creds?.claudeAiOauth as { rateLimitTier?: string } | undefined
    tier = oauth?.rateLimitTier ?? null
  }
  planTierCache = { key, tier }
  return tier
}

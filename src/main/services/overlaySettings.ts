import { z } from 'zod'
import type { OverlaySettings, Settings } from '@shared/types'
import { settingsPatchSchema } from './settingsService'

/** The only settings the overlay window uses: its own munu section and the one
 * swarm flag. Notes, recent projects, the workspace and every other preference
 * stay in main. */
export function projectForOverlay(s: Settings): OverlaySettings {
  return { munu: s.munu, agentActivity: { swarm: s.agentActivity.swarm } }
}

/** What the overlay may write: a partial munu section and nothing else (unknown
 * keys are rejected, not stripped). */
export const overlayPatchSchema = z.object({ munu: settingsPatchSchema.shape.munu.unwrap() }).strict()

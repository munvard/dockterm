/** Reading-comfort knobs and one-tap presets. Pure + unit-testable. */
export type ReadingWidth = 'off' | 'narrow' | 'medium' | 'wide'

export interface ComfortValues {
  lineHeight: number
  letterSpacing: number
  padding: number
  readingWidth: ReadingWidth
}

/** Reading-width option → max content width in px (null = no cap). */
export function readingWidthToMax(value: ReadingWidth): number | null {
  switch (value) {
    case 'narrow':
      return 680
    case 'medium':
      return 860
    case 'wide':
      return 1100
    case 'off':
      return null
  }
}

export type ComfortPreset = 'off' | 'cozy' | 'relaxed'

export const COMFORT_PRESETS: Record<ComfortPreset, ComfortValues> = {
  off: { lineHeight: 1.15, letterSpacing: 0, padding: 8, readingWidth: 'off' },
  cozy: { lineHeight: 1.35, letterSpacing: 0.2, padding: 14, readingWidth: 'medium' },
  relaxed: { lineHeight: 1.5, letterSpacing: 0.3, padding: 20, readingWidth: 'narrow' }
}

/** Which preset the current values match exactly, or 'custom'. */
export function matchPreset(v: ComfortValues): ComfortPreset | 'custom' {
  for (const name of Object.keys(COMFORT_PRESETS) as ComfortPreset[]) {
    const p = COMFORT_PRESETS[name]
    if (
      p.lineHeight === v.lineHeight &&
      p.letterSpacing === v.letterSpacing &&
      p.padding === v.padding &&
      p.readingWidth === v.readingWidth
    ) {
      return name
    }
  }
  return 'custom'
}

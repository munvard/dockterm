/** A press shorter than this is a click: it toggles recording on and the next click turns it off. */
export const MIC_CLICK_MS = 250

export type MicAction = 'start' | 'stop' | 'none'

/**
 * Press-and-hold = talk (stop on release). A short click latches recording on;
 * the next press stops it.
 */
export function createMicGesture(now: () => number = Date.now): {
  down: (active: boolean) => MicAction
  up: () => MicAction
} {
  let downAt = 0
  let stoppedOnDown = false
  return {
    down(active) {
      if (active) {
        stoppedOnDown = true
        return 'stop'
      }
      stoppedOnDown = false
      downAt = now()
      return 'start'
    },
    up() {
      if (stoppedOnDown) {
        stoppedOnDown = false
        return 'none'
      }
      return now() - downAt < MIC_CLICK_MS ? 'none' : 'stop'
    }
  }
}

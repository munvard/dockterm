/**
 * Steps the decorative looping animations (the mascots' bob, blink and pulse loops,
 * and the SMIL inside munu's SVGs) at a low, fixed frame rate instead of the display
 * rate. A running infinite animation makes Chromium produce a full frame at the
 * monitor's refresh rate (120 Hz on a ProMotion Mac, 180 Hz on a gaming monitor),
 * which kept the renderer and GPU busy the whole time agents were running. Paused
 * animations whose currentTime is advanced from a timer render only on each step.
 *
 * Only infinite CSS animations are adopted: one-shot entrances and the "done" hop
 * keep their full frame rate, and spinners listed in SMOOTH stay smooth. While the
 * document is hidden nothing ticks at all.
 */

export const MOTION_FPS = 20

/** Infinite animations that must stay at the display rate (short-lived spinners). */
export const SMOOTH_ANIMATIONS: ReadonlySet<string> = new Set(['dt-spin'])

export interface SteppedAnimation {
  readonly animationName: string
  readonly effect: { getTiming(): { iterations?: number }; readonly target?: Element | null } | null
  readonly startTime: number | null | unknown
  currentTime: number | null | unknown
  readonly playState: string
  pause(): void
}

export interface SteppedSvg {
  readonly isConnected: boolean
  pauseAnimations(): void
  animationsPaused(): boolean
  getCurrentTime(): number
  setCurrentTime(seconds: number): void
}

export interface MotionScheduler {
  every(ms: number, fn: () => void): unknown
  cancel(handle: unknown): void
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export class MotionGovernor {
  private readonly anims = new Map<SteppedAnimation, number>()
  private readonly svgs = new Map<SteppedSvg, { base: number; t0: number }>()
  private handle: unknown = null
  private visible = true

  constructor(
    private readonly now: () => number,
    private readonly scheduler: MotionScheduler,
    private readonly fps = MOTION_FPS
  ) {}

  /** Take over an animation if it is an infinite, non-smooth CSS animation. */
  adopt(anim: SteppedAnimation): boolean {
    if (this.anims.has(anim) || SMOOTH_ANIMATIONS.has(anim.animationName)) return false
    const iterations = anim.effect?.getTiming().iterations
    if (iterations !== Infinity) return false
    const t = this.now()
    const origin = num(anim.startTime) ?? t - (num(anim.currentTime) ?? 0)
    anim.pause()
    anim.currentTime = t - origin
    this.anims.set(anim, origin)
    this.run()
    return true
  }

  /** Take over the SMIL timeline of an inline SVG (it keeps its current phase). */
  adoptSvg(svg: SteppedSvg): void {
    if (this.svgs.has(svg)) return
    const base = svg.getCurrentTime()
    svg.pauseAnimations()
    this.svgs.set(svg, { base, t0: this.now() })
    this.run()
  }

  /** Document visibility: hidden stops every tick; the loops stay frozen where they were. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return
    this.visible = visible
    if (visible) {
      this.tick()
      this.run()
    } else {
      this.stop()
    }
  }

  get size(): number {
    return this.anims.size + this.svgs.size
  }

  get running(): boolean {
    return this.handle !== null
  }

  tick(): void {
    const t = this.now()
    for (const [anim, origin] of this.anims) {
      const target = anim.effect?.target
      if (anim.playState === 'idle' || (target != null && !target.isConnected)) {
        this.anims.delete(anim)
        continue
      }
      anim.currentTime = t - origin
    }
    for (const [svg, s] of this.svgs) {
      if (!svg.isConnected) {
        this.svgs.delete(svg)
        continue
      }
      // An SVG paused in the same task it was inserted in is restarted when its
      // SMIL timeline begins, so pause again until it sticks.
      if (!svg.animationsPaused()) svg.pauseAnimations()
      svg.setCurrentTime(s.base + (t - s.t0) / 1000)
    }
    if (this.size === 0) this.stop()
  }

  private run(): void {
    if (this.handle !== null || !this.visible || this.size === 0) return
    this.handle = this.scheduler.every(Math.round(1000 / this.fps), () => this.tick())
  }

  private stop(): void {
    if (this.handle === null) return
    this.scheduler.cancel(this.handle)
    this.handle = null
  }
}

let shared: MotionGovernor | null = null

/** The document's governor, created on first use (renderer and overlay each get one). */
export function motionGovernor(): MotionGovernor {
  if (shared) return shared
  const gov = new MotionGovernor(
    () => num(document.timeline.currentTime) ?? performance.now(),
    { every: (ms, fn) => setInterval(fn, ms), cancel: (h) => clearInterval(h as ReturnType<typeof setInterval>) }
  )
  shared = gov
  document.addEventListener(
    'animationstart',
    (e) => {
      const el = e.target as Element | null
      if (!el?.getAnimations) return
      for (const a of el.getAnimations()) {
        if ('animationName' in a && (a as CSSAnimation).animationName === e.animationName) {
          gov.adopt(a as CSSAnimation as unknown as SteppedAnimation)
        }
      }
    },
    true
  )
  const sync = (): void => gov.setVisible(document.visibilityState !== 'hidden')
  document.addEventListener('visibilitychange', sync)
  sync()
  return gov
}

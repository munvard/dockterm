import { describe, expect, it } from 'vitest'
import { MotionGovernor, type SteppedAnimation, type SteppedSvg } from '@renderer/components/common/motionGovernor'

function harness() {
  let t = 1000
  const timers = new Map<number, { ms: number; fn: () => void }>()
  let next = 1
  const gov = new MotionGovernor(
    () => t,
    {
      every: (ms, fn) => {
        const h = next++
        timers.set(h, { ms, fn })
        return h
      },
      cancel: (h) => void timers.delete(h as number)
    },
    20
  )
  return {
    gov,
    timers,
    advance(ms: number) {
      t += ms
      for (const { fn } of [...timers.values()]) fn()
    },
    get now() {
      return t
    }
  }
}

function anim(name: string, iterations: number, startTime: number | null, currentTime = 0) {
  const target = { isConnected: true }
  const a = {
    animationName: name,
    effect: { getTiming: () => ({ iterations }), target: target as unknown as Element },
    startTime,
    currentTime: currentTime as number | null,
    playState: 'running',
    paused: false,
    pause() {
      this.paused = true
      this.playState = 'paused'
    }
  }
  return { a: a as typeof a & SteppedAnimation, target }
}

function svg(time = 0) {
  const s = {
    isConnected: true as boolean,
    paused: false,
    time,
    pauseAnimations() {
      this.paused = true
    },
    animationsPaused() {
      return this.paused
    },
    getCurrentTime(): number {
      return this.time
    },
    setCurrentTime(sec: number) {
      this.time = sec
    }
  }
  return s satisfies SteppedSvg
}

describe('MotionGovernor', () => {
  it('adopts infinite loops, pauses them and steps them on a 50 ms timer keeping their phase', () => {
    const h = harness()
    const { a } = anim('munu-bob', Infinity, 400)
    expect(h.gov.adopt(a)).toBe(true)
    expect(a.paused).toBe(true)
    expect(a.currentTime).toBe(600)
    expect([...h.timers.values()].map((x) => x.ms)).toEqual([50])
    h.advance(50)
    expect(a.currentTime).toBe(650)
  })

  it('leaves one-shot animations and smooth spinners alone', () => {
    const h = harness()
    const hop = anim('munu-hop', 1, 900).a
    const spin = anim('dt-spin', Infinity, 900).a
    expect(h.gov.adopt(hop)).toBe(false)
    expect(h.gov.adopt(spin)).toBe(false)
    expect(hop.paused || spin.paused).toBe(false)
    expect(h.gov.running).toBe(false)
  })

  it('derives the origin from currentTime when startTime is unresolved', () => {
    const h = harness()
    const { a } = anim('agent-blink', Infinity, null, 250)
    h.gov.adopt(a)
    h.advance(100)
    expect(a.currentTime).toBe(350)
  })

  it('steps SMIL timelines from their current time', () => {
    const h = harness()
    const s = svg(2)
    h.gov.adoptSvg(s)
    expect(s.paused).toBe(true)
    h.advance(500)
    expect(s.time).toBeCloseTo(2.5)
  })

  it('re-pauses an SVG whose SMIL timeline restarted after adoption', () => {
    const h = harness()
    const s = svg()
    h.gov.adoptSvg(s)
    s.paused = false
    h.advance(50)
    expect(s.paused).toBe(true)
  })

  it('drops detached or cancelled animations and stops ticking when nothing is left', () => {
    const h = harness()
    const one = anim('munu-float', Infinity, 0)
    const two = anim('bug-bob', Infinity, 0)
    const s = svg()
    h.gov.adopt(one.a)
    h.gov.adopt(two.a)
    h.gov.adoptSvg(s)
    one.target.isConnected = false
    two.a.playState = 'idle'
    s.isConnected = false
    h.advance(50)
    expect(h.gov.size).toBe(0)
    expect(h.gov.running).toBe(false)
    expect(h.timers.size).toBe(0)
  })

  it('does not tick while hidden and resumes in phase when visible again', () => {
    const h = harness()
    const { a } = anim('munu-attn', Infinity, 0)
    h.gov.adopt(a)
    h.gov.setVisible(false)
    expect(h.timers.size).toBe(0)
    h.advance(5000)
    expect(a.currentTime).toBe(1000)
    h.gov.setVisible(true)
    expect(a.currentTime).toBe(h.now)
    expect(h.gov.running).toBe(true)
  })

  it('does not start a timer for an animation adopted while hidden', () => {
    const h = harness()
    h.gov.setVisible(false)
    h.gov.adopt(anim('munu-sleep', Infinity, 0).a)
    expect(h.timers.size).toBe(0)
  })
})

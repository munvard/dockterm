import { useLayoutEffect, useMemo, useRef } from 'react'
import type { MunuState } from '../../state/munuAggregate'
import type { MascotCharacter } from '@shared/types'
import { artFor } from './mascots'
import { motionGovernor } from '../common/motionGovernor'
import './munu.css'

/** The live, animated mascot. `done` shows the happy face; `sleeping` overrides all. */
export function Munu({
  state,
  character = 'munu',
  sleeping: isSleeping = false,
  size = 24
}: {
  state: MunuState
  character?: MascotCharacter
  sleeping?: boolean
  size?: number
}) {
  const kind = isSleeping ? 'sleeping' : state
  const raw = artFor(character, state, isSleeping)
  // A stable object: React compares the prop by identity and would otherwise
  // re-parse the SVG (and restart its SMIL) on every re-render.
  const html = useMemo(() => ({ __html: raw }), [raw])
  const ref = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    const svg = ref.current?.querySelector('svg')
    if (svg && raw.includes('<animate')) motionGovernor().adoptSvg(svg)
  }, [raw])
  return (
    <span
      ref={ref}
      className={`munu munu--${kind}`}
      style={{ width: size, height: size }}
      // Bundled, trusted asset — not user input.
      dangerouslySetInnerHTML={html}
    />
  )
}

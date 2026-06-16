import type { MunuState } from '../../state/munuAggregate'
import resting from '../../assets/munu/munu.svg'
import happy from '../../assets/munu/munu-happy.svg'
import working from '../../assets/munu/munu-working.svg'
import sleeping from '../../assets/munu/munu-sleeping.svg'
import asking from '../../assets/munu/munu-asking.svg'

/** Maps a munu state (+ project presence) to its art. `done` shows the happy face. */
const ART: Record<MunuState, string> = {
  idle: resting,
  working,
  asking,
  done: happy
}

export function MunuFace({
  state,
  hasProject = true,
  size = 22
}: {
  state: MunuState
  hasProject?: boolean
  size?: number
}) {
  const src = !hasProject ? sleeping : ART[state]
  return <img src={src} width={size} height={size} alt={`munu ${state}`} draggable={false} />
}

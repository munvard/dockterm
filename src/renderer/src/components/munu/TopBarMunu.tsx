import { useMunuStore } from '../../state/useMunuStore'
import { useAppStore } from '../../state/useAppStore'
import { MunuFace } from './MunuFace'

const LABEL: Record<string, string> = {
  idle: 'resting',
  working: 'working…',
  asking: 'needs you',
  done: 'done'
}

export function TopBarMunu() {
  const state = useMunuStore((s) => s.munuState())
  const hasProject = useAppStore((s) => !!s.project)
  const label = !hasProject ? 'sleeping' : LABEL[state]
  return (
    <div className={`topbar-munu topbar-munu--${state}`} title={`munu · ${label}`}>
      <MunuFace state={state} hasProject={hasProject} size={22} />
    </div>
  )
}

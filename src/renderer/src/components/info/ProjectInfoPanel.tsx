import { useEffect, useState } from 'react'
import { RefreshCw, Play } from 'lucide-react'
import { useAppStore } from '../../state/useAppStore'
import { useTerminalBus } from '../../state/useTerminalBus'
import type { ProjectInfoData } from '@shared/types'

function toHttps(remote: string): string {
  const r = remote.trim()
  const ssh = r.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  return r.replace(/\.git$/, '')
}

export function ProjectInfoPanel() {
  const [info, setInfo] = useState<ProjectInfoData | null>(null)
  const project = useAppStore((s) => s.project)
  const activeRoot = useAppStore((s) => s.activeRoot)
  const setMiniTermOpen = useAppStore((s) => s.setMiniTermOpen)
  const runInMini = useTerminalBus((s) => s.runInMini)

  const load = () => {
    void window.dockterm.invoke('info:get', undefined).then((r) => {
      if (r.ok) setInfo(r.value)
    })
  }

  // info:get reads the FOCUSED pane's resolved root (activeRoot), not the
  // static first-opened project — reload on the same signal so this panel
  // never keeps showing a different project's info after focus moves.
  useEffect(() => {
    load()
  }, [activeRoot])

  const pm = info?.packageManager ?? 'npm'
  const runCommand = (name: string): string => (pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`)
  const runScript = (name: string) => {
    setMiniTermOpen(true)
    runInMini(runCommand(name))
  }

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="panel__title">Project Info</span>
        <div className="panel__actions">
          <button className="iconbtn iconbtn--sm" title="Refresh" onClick={load}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>
      <div className="panel__body">
        <div className="info-section">
          <div className="info-section__title">Project</div>
          <div className="info-row">
            <span className="info-row__key">Name</span>
            <span className="info-row__val">{info?.name ?? project?.name}</span>
          </div>
          {info?.packageManager && (
            <div className="info-row">
              <span className="info-row__key">Package manager</span>
              <span className="info-row__val">{info.packageManager}</span>
            </div>
          )}
          <div className="info-row">
            <span className="info-row__key">Root</span>
            <span className="info-row__val" title={info?.root}>
              {info?.root}
            </span>
          </div>
          {info?.remote && (
            <div className="info-row">
              <span className="info-row__key">Remote</span>
              <button
                className="info-link"
                title={info.remote}
                onClick={() =>
                  void window.dockterm.invoke('app:openExternal', { url: toHttps(info.remote ?? '') })
                }
              >
                {info.remote}
              </button>
            </div>
          )}
        </div>

        {info && info.frameworks.length > 0 && (
          <div className="info-section">
            <div className="info-section__title">Detected</div>
            <div className="info-chips">
              {info.frameworks.map((f) => (
                <span key={f} className="info-chip">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}

        {info && info.scripts.length > 0 && (
          <div className="info-section">
            <div className="info-section__title">Scripts</div>
            {info.scripts.map((s) => (
              <div className="info-script" key={s.name}>
                <span className="info-script__name">{s.name}</span>
                <span className="info-script__cmd" title={s.command}>
                  {s.command}
                </span>
                <button
                  className="iconbtn iconbtn--sm info-script__run"
                  title={`Run in mini terminal: ${runCommand(s.name)}`}
                  onClick={() => runScript(s.name)}
                >
                  <Play size={13} />
                </button>
              </div>
            ))}
            <div className="review-hint">
              Run pastes the command into the mini terminal — press Enter to run it.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

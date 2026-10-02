import { useEffect, useState } from 'react'
import { Settings2, X } from 'lucide-react'
import type { UsageFloatView, UsageFloatPatch } from '@shared/ipc'
import { USAGE_METRICS, USAGE_STYLES, type UsageStyle } from '@shared/usageReal'
import { UsageReadout } from '@renderer/components/usage/UsageReadout'
import { useLiveUsage } from '@renderer/components/usage/useLiveUsage'
import { resolveTheme } from '@renderer/state/themes'
import {
  METRIC_NAME,
  burnRate,
  fmtAge,
  fmtClock,
  fmtRate,
  hasNoData,
  readingsFor,
  toggleMetric,
  usageTooltip
} from '@renderer/state/usageView'

const STYLE_LABEL: Record<UsageStyle, string> = { percent: 'Percent', bar: 'Bar', ring: 'Ring', graph: 'Graph' }

function paintTheme(selection: string): void {
  const dark = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)').matches : true
  const theme = resolveTheme(selection, dark)
  const root = document.documentElement
  for (const [k, v] of Object.entries(theme.ui)) root.style.setProperty(`--${k}`, v)
  root.dataset.appearance = theme.appearance
}

export function UsageWidget() {
  const [view, setView] = useState<UsageFloatView | null>(null)
  const [menu, setMenu] = useState(false)
  const { real, history, now } = useLiveUsage(true)

  useEffect(() => {
    const apply = (v: UsageFloatView): void => {
      setView(v)
      paintTheme(v.theme)
    }
    void window.dockterm.invoke('usageFloat:get', undefined).then((r) => r.ok && apply(r.value))
    return window.dockterm.on('usageFloat:changed', apply)
  }, [])

  if (!view) return null
  const f = view.float
  const th = { warnAt: view.warnAt, critAt: view.critAt }
  const readings = readingsFor(real, f.show, th)
  const none = hasNoData(readings)
  const set = (patch: UsageFloatPatch): void => {
    void window.dockterm.invoke('usageFloat:set', patch)
  }
  const rate = real?.fiveHour ? burnRate(history, real.fiveHour.resetsAt, now) : null

  return (
    <div className="uw" title={usageTooltip(real, now, history, th)}>
      <div className="uw__tools">
        <button className="uw__btn" title="Widget settings" onClick={() => setMenu((m) => !m)}>
          <Settings2 size={12} />
        </button>
        <button className="uw__btn" title="Close widget" onClick={() => void window.dockterm.invoke('usageFloat:close', undefined)}>
          <X size={12} />
        </button>
      </div>

      {menu ? (
        <div className="uw__menu">
          <div className="uw__menu-title">Style</div>
          <div className="uset-seg">
            {USAGE_STYLES.map((s) => (
              <button key={s} className={f.style === s ? 'is-on' : ''} onClick={() => set({ style: s })}>
                {STYLE_LABEL[s]}
              </button>
            ))}
          </div>
          <div className="uw__menu-title">Show</div>
          {USAGE_METRICS.map((m) => (
            <label key={m} className="uw__check">
              <input type="checkbox" checked={f.show.includes(m)} onChange={() => set({ show: toggleMetric(f.show, m) })} />
              {METRIC_NAME[m]}
            </label>
          ))}
          <label className="uw__check">
            <input type="checkbox" checked={f.showReset} onChange={() => set({ showReset: !f.showReset })} />
            Reset countdown
          </label>
          <label className="uw__check">
            <input type="checkbox" checked={f.alwaysOnTop} onChange={() => set({ alwaysOnTop: !f.alwaysOnTop })} />
            Always on top
          </label>
          <div className="uw__menu-title">Opacity {Math.round(f.opacity * 100)}%</div>
          <input
            type="range"
            min={30}
            max={100}
            step={5}
            value={Math.round(f.opacity * 100)}
            onChange={(e) => set({ opacity: Number(e.target.value) / 100 })}
          />
          <button className="btn btn--ghost btn--sm uw__done" onClick={() => setMenu(false)}>
            Done
          </button>
        </div>
      ) : none ? (
        <div className="uw__empty">
          <b>{real ? 'no limit data' : 'no data yet'}</b>
          <span>
            {real
              ? 'Claude has sent no limits, or the window has reset.'
              : 'Start Claude in a DockTerm terminal to see your real usage.'}
          </span>
        </div>
      ) : (
        <>
          <div className="uw__body">
            <UsageReadout readings={readings} style={f.style} showReset={f.showReset} real={real} history={history} now={now} variant="widget" />
          </div>
          {real && (
            <div className="uw__foot">
              {real.fiveHour && <span>ends {fmtClock(real.fiveHour.resetsAt)}</span>}
              {rate !== null && <span>{fmtRate(rate)}</span>}
              {real.updatedAt !== null && <span>{fmtAge(now - real.updatedAt)}</span>}
            </div>
          )}
        </>
      )}
    </div>
  )
}

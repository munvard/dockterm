import { useEffect, useState, type ReactNode } from 'react'
import { Modal } from './Modal'
import { Munu } from '../munu/Munu'
import type { UpdateAvailable } from '@shared/ipc'
import { useAppStore } from '../../state/useAppStore'

type Phase = 'idle' | 'downloading' | 'done' | 'error'

/** Render the cleaned release notes (markdown-lite: ## heading, - bullets,
 * **bold**, `code`) as React nodes — no raw markdown shown to the user. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    if (tok.startsWith('**')) out.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else out.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function renderNotes(notes: string): ReactNode[] {
  const out: ReactNode[] = []
  let key = 0
  for (const raw of notes.split('\n')) {
    const t = raw.trim()
    if (!t) continue
    if (t.startsWith('##')) {
      out.push(
        <div className="update-pop__tagline" key={key++}>
          {inline(t.replace(/^#+\s*/, ''))}
        </div>
      )
    } else if (t.startsWith('- ')) {
      out.push(
        <div className="update-pop__bullet" key={key++}>
          {inline(t.slice(2))}
        </div>
      )
    } else {
      out.push(
        <p className="update-pop__p" key={key++}>
          {inline(t)}
        </p>
      )
    }
  }
  return out
}

export function UpdatePopup() {
  const character = useAppStore((s) => s.settings?.munu.character) ?? 'munu'
  const [info, setInfo] = useState<UpdateAvailable | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [percent, setPercent] = useState(0)
  const [relaunching, setRelaunching] = useState(false)

  useEffect(() => window.dockterm.on('update:available', (i) => { setInfo(i); setPhase('idle'); setPercent(0) }), [])
  useEffect(() => window.dockterm.on('update:progress', (p) => { setPhase('downloading'); setPercent(p.percent) }), [])
  useEffect(() => window.dockterm.on('update:downloaded', (d) => { setRelaunching(!!d.relaunching); setPhase('done') }), [])
  useEffect(() => window.dockterm.on('update:error', () => setPhase('error')), [])

  if (!info) return null

  const close = (): void => setInfo(null)
  const openPage = (): void => {
    void window.dockterm.invoke('app:openExternal', { url: info.releaseUrl })
    close()
  }
  const updateNow = (): void => {
    if (info.canAutoUpdate) {
      setPhase('downloading')
      void window.dockterm.invoke('update:download', undefined)
    } else {
      openPage()
    }
  }
  const remindLater = (): void => {
    void window.dockterm.invoke('update:snooze', { hours: 24 })
    close()
  }
  const skip = (): void => {
    void window.dockterm.invoke('update:skip', { version: info.latestVersion })
    close()
  }

  const sub =
    phase === 'downloading'
      ? `Downloading… ${percent}%`
      : phase === 'done'
        ? relaunching
          ? 'Updating and restarting…'
          : 'Downloaded — follow the installer to finish updating.'
        : phase === 'error'
          ? "Couldn't download automatically."
          : 'A new version is ready.'

  return (
    <Modal onClose={phase === 'downloading' ? close : remindLater}>
      <div className="update-pop">
        <div className="update-pop__head">
          <Munu state="done" character={character} size={52} />
          <div>
            <div className="update-pop__title">DockTerm {info.latestVersion} is available</div>
            <div className="update-pop__sub">{sub}</div>
          </div>
        </div>

        {phase === 'idle' && info.notes && (
          <div className="update-pop__notes">{renderNotes(info.notes)}</div>
        )}
        {phase === 'downloading' && (
          <div className="update-pop__bar">
            <div className="update-pop__bar-fill" style={{ width: `${percent}%` }} />
          </div>
        )}

        <div className="update-pop__actions">
          {phase === 'idle' && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={skip}>
                Skip this version
              </button>
              <button className="btn btn--ghost btn--sm" onClick={remindLater}>
                Remind me later
              </button>
              <button className="btn btn--primary btn--sm" onClick={updateNow}>
                Update now
              </button>
            </>
          )}
          {phase === 'downloading' && (
            <button className="btn btn--ghost btn--sm" onClick={close}>
              Hide
            </button>
          )}
          {phase === 'done' && (
            <button className="btn btn--primary btn--sm" onClick={close}>
              Done
            </button>
          )}
          {phase === 'error' && (
            <>
              <button className="btn btn--ghost btn--sm" onClick={close}>
                Close
              </button>
              <button className="btn btn--primary btn--sm" onClick={openPage}>
                Open download page
              </button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}

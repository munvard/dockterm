import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Munu } from '../munu/Munu'
import type { UpdateAvailable } from '@shared/ipc'

/** Listens for `update:available` (poll-based, from main) and shows a branded
 * popup with Update now / Remind me later / Skip. */
export function UpdatePopup() {
  const [info, setInfo] = useState<UpdateAvailable | null>(null)

  useEffect(() => window.dockterm.on('update:available', setInfo), [])

  if (!info) return null

  const close = (): void => setInfo(null)
  const updateNow = (): void => {
    void window.dockterm.invoke('app:openExternal', { url: info.releaseUrl })
    close()
  }
  const remindLater = (): void => {
    void window.dockterm.invoke('update:snooze', { hours: 24 })
    close()
  }
  const skip = (): void => {
    void window.dockterm.invoke('update:skip', { version: info.latestVersion })
    close()
  }

  return (
    <Modal onClose={remindLater}>
      <div className="update-pop">
        <div className="update-pop__head">
          <Munu state="done" size={52} />
          <div>
            <div className="update-pop__title">DockTerm {info.latestVersion} is available</div>
            <div className="update-pop__sub">A new version is ready to download.</div>
          </div>
        </div>
        {info.notes && <pre className="update-pop__notes">{info.notes}</pre>}
        <div className="update-pop__actions">
          <button className="btn btn--ghost btn--sm" onClick={skip}>
            Skip this version
          </button>
          <button className="btn btn--ghost btn--sm" onClick={remindLater}>
            Remind me later
          </button>
          <button className="btn btn--primary btn--sm" onClick={updateNow}>
            Update now
          </button>
        </div>
      </div>
    </Modal>
  )
}

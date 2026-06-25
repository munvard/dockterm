import { serializeAllPersistent, setTerminalPersistence } from './terminalPool'

/**
 * Wire up terminal scrollback persistence: save every live persistent terminal's
 * serialized buffer periodically and when the window is closing, so a full quit +
 * relaunch restores the on-screen history. Returns a cleanup fn.
 */
export function setupTerminalPersistence(enabled: boolean): () => void {
  setTerminalPersistence(enabled)
  if (!enabled) return () => {}
  const save = (): void => {
    const buffers = serializeAllPersistent()
    if (buffers.length) void window.dockterm.invoke('terminal:saveBuffers', { buffers })
  }
  const iv = setInterval(save, 20_000)
  window.addEventListener('beforeunload', save)
  return () => {
    clearInterval(iv)
    window.removeEventListener('beforeunload', save)
    save()
  }
}

import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { INVOKE_CHANNELS, EVENT_CHANNELS, type DockTermApi } from '@shared/ipc'

/**
 * The entire surface the renderer can touch. It forwards to ipcRenderer but only
 * for channels on the shared allowlists — the renderer cannot reach arbitrary
 * Electron IPC. No Node objects cross the bridge.
 */
const api: DockTermApi = {
  invoke(channel, req) {
    if (!INVOKE_CHANNELS.includes(channel)) {
      return Promise.resolve({
        ok: false,
        error: { code: 'VALIDATION', message: `Unknown channel: ${String(channel)}` }
      }) as never
    }
    return ipcRenderer.invoke(channel, req) as never
  },
  on(event, cb) {
    if (!EVENT_CHANNELS.includes(event)) return () => {}
    const listener = (_e: IpcRendererEvent, payload: unknown): void => cb(payload as never)
    ipcRenderer.on(event as string, listener)
    return () => {
      ipcRenderer.removeListener(event as string, listener)
    }
  },
  pathForFile(file) {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

contextBridge.exposeInMainWorld('dockterm', api)

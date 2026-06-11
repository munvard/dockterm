import type { DockTermApi } from '@shared/ipc'

declare global {
  interface Window {
    dockterm: DockTermApi
  }
}

export {}

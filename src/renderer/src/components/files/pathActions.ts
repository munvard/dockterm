import { quoteShellArg, shellKindFor } from '@shared/shellQuote'
import { useAppStore } from '../../state/useAppStore'
import { useToastStore } from '../../state/useToastStore'
import { useWorkspaceStore } from '../../state/useWorkspaceStore'
import { paneWriters } from '../../state/paneWriters'

export function platformName(): string {
  return document.documentElement.dataset.platform ?? ''
}

/** Join a project root with a forward-slash relPath, matching the root's separator. */
export function joinAbs(root: string, relPath: string): string {
  if (!relPath) return root
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  const rel = sep === '\\' ? relPath.split('/').join('\\') : relPath
  return root.endsWith(sep) ? root + rel : root + sep + rel
}

export function parentOf(relPath: string): string {
  const i = relPath.lastIndexOf('/')
  return i >= 0 ? relPath.slice(0, i) : ''
}

export function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf('/') + 1)
}

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** Paste text into the focused terminal pane the way a user paste would. */
export function pasteToFocusedPane(text: string): boolean {
  const { tabs, activeId } = useWorkspaceStore.getState()
  const tab = tabs.find((t) => t.id === activeId)
  return tab ? paneWriters.paste(tab.focusedLeafId, text) : false
}

/** Absolute, shell-quoted paths for the focused terminal, space separated with a trailing space. */
export function terminalPathText(root: string, relPaths: string[]): string {
  const shell = shellKindFor(platformName())
  return relPaths.map((rel) => quoteShellArg(joinAbs(root, rel), shell)).join(' ') + ' '
}

export function sendPathsToTerminal(relPaths: string[]): boolean {
  const root = useAppStore.getState().activeRoot
  if (!root || relPaths.length === 0) return false
  const ok = pasteToFocusedPane(terminalPathText(root, relPaths))
  if (!ok) useToastStore.getState().push('Open a terminal first to send paths to it', 'error')
  return ok
}

export async function copyToClipboard(text: string, what: string): Promise<void> {
  const r = await window.dockterm.invoke('clipboard:write', { text })
  useToastStore.getState().push(r.ok ? `Copied ${what}` : 'Copy failed', r.ok ? 'success' : 'error')
}

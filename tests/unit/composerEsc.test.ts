// @vitest-environment jsdom
/// <reference path="../../src/renderer/src/dockterm.d.ts" />
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElement, act } from 'react'
import { createRoot } from 'react-dom/client'

vi.mock('@renderer/components/terminal/terminalPool', () => ({
  paneVisibleText: () => '',
  paneBracketedPasteMode: () => true,
  paneSessionId: () => 's1',
  paneBufferType: () => 'normal'
}))
vi.mock('@renderer/components/terminal/paneClaudeActive', () => ({
  paneClaudeForeground: async () => true,
  paneClaudeActive: async () => true
}))
const invoke = vi.fn(async (channel: string) => {
  if (channel === 'claude:skillsRead') return { ok: true, value: { skills: [], commands: [] } }
  if (channel === 'fs:search') return { ok: true, value: [] }
  return { ok: true, value: undefined }
})
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Composer Esc', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = () => {}
    ;(window as unknown as { dockterm: unknown }).dockterm = { invoke, on: () => () => {}, pathForFile: () => '' }
  })
  it('Esc on the @ note does not write ESC to the pane; plain Esc still does', async () => {
    // A variable specifier: the node tsconfig has no JSX support, so tsc must not follow the .tsx.
    const composerPath = '@renderer/components/chat/Composer'
    const { Composer } = (await import(/* @vite-ignore */ composerPath)) as {
      Composer: (props: Record<string, unknown>) => unknown
    }
    const { paneWriters } = await import('@renderer/state/paneWriters')
    const writes: string[] = []
    paneWriters.register('L', { write: (t) => writes.push(t), paste: () => {}, bracketedPaste: () => true })
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(createElement(Composer as never, { leafId: 'L', disabled: false, onSentPicker: () => {} })) })
    const ta = host.querySelector('textarea.composer__input') as HTMLTextAreaElement
    const setVal = (v: string): void => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, v)
      ta.setSelectionRange(v.length, v.length)
      ta.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await act(async () => setVal('look at @'))
    expect(host.textContent).toContain('Type to search project files')
    await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(writes).toEqual([])
    expect(host.textContent).not.toContain('Type to search project files')
    await act(async () => { ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(writes).toEqual(['\x1b'])
  })
})

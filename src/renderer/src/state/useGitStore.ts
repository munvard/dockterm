import { create } from 'zustand'
import type { GitStatusView, GitBranches } from '@shared/types'
import { useToastStore } from './useToastStore'
import { useDialogStore } from './useDialogStore'
import { createGitGate } from './gitGate'

interface GitState {
  status: GitStatusView | null
  branches: GitBranches | null
  busy: boolean
  /** True while a git:status request is in flight. */
  loading: boolean
  /** Set when the last refresh failed for a reason OTHER than "not a repo" (e.g.
   * dubious ownership, a permission error, a timeout). The panel must never read
   * a failed refresh as "not a git repository" — that was the actual cause of
   * "Git not initialized" showing for a real repo. */
  error: string | null
  log: string[]
  /** Commit message draft. Lives here (not component state) so switching panels
   * or tabs never loses what the user typed. */
  draftMessage: string
  setDraftMessage: (message: string) => void
  refresh: () => Promise<void>
  refreshBranches: () => Promise<void>
  stage: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstage: (paths: string[]) => Promise<void>
  discard: (paths: string[], label: string) => Promise<void>
  commit: (message: string) => Promise<boolean>
  push: (options?: { setUpstream?: boolean; forceWithLease?: boolean }) => Promise<void>
  pull: () => Promise<void>
  createBranch: (name: string) => Promise<void>
  switchBranch: (name: string) => Promise<void>
  deleteBranch: (name: string) => Promise<void>
  /** Clear known state (including the commit draft — a message typed for one
   * repo must never carry over and get committed into a different one) — call
   * before pointing the store at a different repo root so a slow-arriving status
   * for the OLD root can never be mistaken for the new one, and the panel shows a
   * neutral "loading" state instead of stale data. */
  reset: () => void
}

const invokeGitGated = createGitGate((channel, req) => window.dockterm.invoke(channel, req))

const toast = (msg: string, kind: 'success' | 'error' | 'info' | 'warning') =>
  useToastStore.getState().push(msg, kind)

/** A failed git action becomes an error toast — except a Cancel the user chose
 * in the "repo config runs commands" dialog, which is not an error. */
const reportFailure = (error: { code: string; message: string }): void => {
  if (error.code !== 'CANCELED') toast(error.message, 'error')
}

// Bumped on every refresh() call. A response only ever applies if it's still the
// most recent request — an older, slower request (e.g. still in flight from the
// project root this window just navigated away from) can never clobber a newer
// one that already landed (out-of-order git:status responses across a fast
// focus/root switch).
let refreshSeq = 0

export const useGitStore = create<GitState>((set, get) => ({
  status: null,
  branches: null,
  busy: false,
  loading: false,
  error: null,
  log: [],
  draftMessage: '',
  setDraftMessage: (message) => set({ draftMessage: message }),

  refresh: async () => {
    const seq = ++refreshSeq
    set({ loading: true })
    const res = await window.dockterm.invoke('git:status', undefined)
    if (seq !== refreshSeq) return // superseded by a newer refresh
    if (res.ok) {
      set({ status: res.value, loading: false, error: null })
    } else {
      // Keep whatever status we already had on screen; surface the failure
      // instead of silently going blank (which used to read as "not a repo").
      set({ loading: false, error: res.error.message })
    }
  },

  refreshBranches: async () => {
    const res = await window.dockterm.invoke('git:branches', undefined)
    if (res.ok) set({ branches: res.value })
  },

  stage: async (paths) => {
    const res = await invokeGitGated('git:stage', { paths })
    if (!res.ok) reportFailure(res.error)
    await get().refresh()
  },

  stageAll: async () => {
    const res = await invokeGitGated('git:stageAll', undefined)
    if (!res.ok) reportFailure(res.error)
    await get().refresh()
  },

  unstage: async (paths) => {
    const res = await invokeGitGated('git:unstage', { paths })
    if (!res.ok) reportFailure(res.error)
    await get().refresh()
  },

  discard: async (paths, label) => {
    const confirmed = await useDialogStore.getState().confirm({
      title: 'Discard changes',
      message: `Discard your changes to ${label}?`,
      detail: 'This restores the file(s) from Git and cannot be undone.',
      confirmLabel: 'Discard',
      danger: true,
      command: `git restore -- ${paths.join(' ')}`
    })
    if (!confirmed) return
    const res = await invokeGitGated('git:discard', { paths })
    if (!res.ok) reportFailure(res.error)
    await get().refresh()
  },

  commit: async (message) => {
    set({ busy: true })
    const res = await invokeGitGated('git:commit', { message })
    set({ busy: false })
    if (!res.ok) {
      reportFailure(res.error)
      return false
    }
    toast(`Committed ${res.value.hash.slice(0, 7)} — ${res.value.summary}`, 'success')
    set({ draftMessage: '' })
    await get().refresh()
    return true
  },

  push: async (options) => {
    set({ busy: true })
    const res = await invokeGitGated('git:push', options ?? {})
    set({ busy: false })
    if (!res.ok) {
      if (res.error.code === 'NO_UPSTREAM') {
        const publish = await useDialogStore.getState().confirm({
          title: 'No upstream branch',
          message: 'This branch has not been published to the remote yet.',
          detail: 'Publish it to origin so you can push?',
          confirmLabel: 'Publish branch',
          command: 'git push --set-upstream origin <branch>'
        })
        if (publish) await get().push({ setUpstream: true })
        return
      }
      reportFailure(res.error)
      return
    }
    set((s) => ({ log: [...s.log, res.value.output].slice(-50) }))
    toast(res.value.output, 'success')
    await get().refresh()
  },

  pull: async () => {
    set({ busy: true })
    const res = await invokeGitGated('git:pull', undefined)
    set({ busy: false })
    if (!res.ok) {
      reportFailure(res.error)
      return
    }
    set((s) => ({ log: [...s.log, res.value.output].slice(-50) }))
    toast(res.value.output, 'success')
    await get().refresh()
  },

  createBranch: async (name) => {
    const res = await invokeGitGated('git:createBranch', { name })
    if (!res.ok) {
      reportFailure(res.error)
      return
    }
    await Promise.all([get().refresh(), get().refreshBranches()])
  },

  switchBranch: async (name) => {
    const res = await invokeGitGated('git:switchBranch', { name })
    if (!res.ok) {
      reportFailure(res.error)
      return
    }
    await Promise.all([get().refresh(), get().refreshBranches()])
  },

  deleteBranch: async (name) => {
    const confirmed = await useDialogStore.getState().confirm({
      title: 'Delete branch',
      message: `Delete the branch "${name}"?`,
      detail: 'Git will refuse if the branch has unmerged commits.',
      confirmLabel: 'Delete branch',
      danger: true,
      command: `git branch -d ${name}`
    })
    if (!confirmed) return
    const res = await invokeGitGated('git:deleteBranch', { name })
    if (!res.ok) {
      reportFailure(res.error)
      return
    }
    await get().refreshBranches()
  },

  reset: () =>
    set({ status: null, branches: null, log: [], loading: false, error: null, draftMessage: '' })
}))

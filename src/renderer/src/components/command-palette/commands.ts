import { useAppStore } from '../../state/useAppStore'
import { useGitStore } from '../../state/useGitStore'
import { useReviewStore } from '../../state/useReviewStore'
import { k } from '../../hooks/keys'

export interface AppCommand {
  id: string
  title: string
  group: string
  shortcut?: string
  run: () => void
}

export function buildCommands(): AppCommand[] {
  const app = useAppStore.getState()
  const git = useGitStore.getState()
  const review = useReviewStore.getState()

  return [
    { id: 'open-project', title: 'Open Project…', group: 'Project', shortcut: k('⌘O', 'Ctrl+Shift+O'), run: () => void app.openProjectDialog() },
    { id: 'toggle-files', title: 'Toggle Files', group: 'View', shortcut: k('⌘B', 'Ctrl+Shift+B'), run: () => app.togglePanel('files') },
    { id: 'toggle-git', title: 'Toggle Source Control', group: 'View', shortcut: k('⌘G', 'Ctrl+Shift+G'), run: () => app.togglePanel('git') },
    { id: 'toggle-review', title: 'Toggle Review', group: 'View', shortcut: k('⌘E', 'Ctrl+Shift+E'), run: () => app.togglePanel('review') },
    { id: 'toggle-mcp', title: 'Toggle MCP Servers', group: 'View', shortcut: k('⌘⇧M', 'Ctrl+Shift+M'), run: () => app.togglePanel('mcp') },
    { id: 'toggle-skills', title: 'Toggle Skills', group: 'View', run: () => app.togglePanel('skills') },
    { id: 'toggle-mini', title: 'Toggle Mini Terminal', group: 'View', shortcut: k('⌘J', 'Ctrl+Shift+J'), run: () => app.toggleMiniTerm() },
    { id: 'toggle-reading', title: 'Toggle Reading View', group: 'View', run: () => app.toggleReading() },
    { id: 'toggle-zen', title: 'Toggle Zen Mode', group: 'View', shortcut: k('⌘.', 'Ctrl+Shift+.'), run: () => app.toggleZen() },
    { id: 'open-settings', title: 'Open Settings', group: 'View', shortcut: k('⌘,', 'Ctrl+,'), run: () => app.setOpenPanel('settings') },
    { id: 'git-stage-all', title: 'Git: Stage All Changes', group: 'Git', run: () => void git.stageAll() },
    { id: 'git-commit', title: 'Git: Commit…', group: 'Git', run: () => app.setOpenPanel('git') },
    { id: 'git-push', title: 'Git: Push', group: 'Git', run: () => void git.push() },
    { id: 'git-pull', title: 'Git: Pull', group: 'Git', run: () => void git.pull() },
    { id: 'review-checkpoint', title: 'Create Checkpoint', group: 'Review', run: () => void review.createCheckpoint('') },
    { id: 'review-open', title: 'Open Review', group: 'Review', run: () => app.setOpenPanel('review') }
  ]
}

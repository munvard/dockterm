import type { LucideIcon } from 'lucide-react'
import {
  FolderTree,
  FileSearch,
  GitBranch,
  GitCompare,
  Plug,
  Sparkles,
  Bot,
  Workflow,
  Activity,
  Info,
  Settings
} from 'lucide-react'
import type { PanelId } from '@shared/types'

export interface PanelDef {
  id: PanelId
  label: string
  icon: LucideIcon
}

/** Dock panels, added here as each is implemented (no buttons for unbuilt panels). */
export const PANELS: PanelDef[] = [
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'search', label: 'Find in Files', icon: FileSearch },
  { id: 'git', label: 'Source Control', icon: GitBranch },
  { id: 'review', label: 'Review', icon: GitCompare },
  { id: 'mcp', label: 'MCP Servers', icon: Plug },
  { id: 'skills', label: 'Skills', icon: Sparkles },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'activity', label: 'Activity', icon: Workflow },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'info', label: 'Project Info', icon: Info },
  { id: 'settings', label: 'Settings', icon: Settings }
]

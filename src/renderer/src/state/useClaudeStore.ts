import { create } from 'zustand'
import type { McpReadResult, SkillsReadResult, AgentsReadResult, SkillTemplate } from '@shared/types'
import { useAppStore } from './useAppStore'
import { useToastStore } from './useToastStore'

function includeUser(): boolean {
  return useAppStore.getState().settings?.claude.readUserConfig ?? false
}

interface ClaudeState {
  mcp: McpReadResult | null
  skills: SkillsReadResult | null
  agents: AgentsReadResult | null
  readMcp: () => Promise<void>
  createMcpTemplate: () => Promise<string | null>
  readSkills: () => Promise<void>
  readAgents: () => Promise<void>
  createSkill: (
    name: string,
    kind: 'skill' | 'command',
    template: SkillTemplate
  ) => Promise<string | null>
}

export const useClaudeStore = create<ClaudeState>((set) => ({
  mcp: null,
  skills: null,
  agents: null,

  readMcp: async () => {
    const res = await window.dockterm.invoke('claude:mcpRead', { includeUser: includeUser() })
    if (res.ok) set({ mcp: res.value })
    else useToastStore.getState().push(res.error.message, 'error')
  },

  createMcpTemplate: async () => {
    const res = await window.dockterm.invoke('claude:mcpCreateTemplate', undefined)
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return null
    }
    useToastStore.getState().push('Created .mcp.json', 'success')
    return res.value.relPath
  },

  readSkills: async () => {
    const res = await window.dockterm.invoke('claude:skillsRead', { includeUser: includeUser() })
    if (res.ok) set({ skills: res.value })
    else useToastStore.getState().push(res.error.message, 'error')
  },

  readAgents: async () => {
    const res = await window.dockterm.invoke('claude:agentsRead', { includeUser: includeUser() })
    if (res.ok) set({ agents: res.value })
    else useToastStore.getState().push(res.error.message, 'error')
  },

  createSkill: async (name, kind, template) => {
    const res = await window.dockterm.invoke('claude:skillCreate', { name, kind, template })
    if (!res.ok) {
      useToastStore.getState().push(res.error.message, 'error')
      return null
    }
    useToastStore.getState().push(`Created ${res.value.relPath}`, 'success')
    return res.value.relPath
  }
}))

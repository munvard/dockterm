import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { homedir } from 'node:os'
import type {
  SkillView,
  CommandView,
  SkillsReadResult,
  SkillTemplate,
  AgentView,
  AgentsReadResult,
  ItemScope
} from '@shared/types'
import { listInstalledPlugins } from './pluginDirs'
import { getSettings } from './settingsService'

function parseFrontmatter(text: string): { fm: Record<string, string>; body: string } {
  const match = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return { fm: {}, body: text }
  const fm: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':')
    if (idx > 0) {
      const key = line.slice(0, idx).trim()
      fm[key] = line
        .slice(idx + 1)
        .trim()
        .replace(/^["']|["']$/g, '')
    }
  }
  return { fm, body: match[2] }
}

function describe(fm: Record<string, string>, body: string): string {
  if (fm.description) return fm.description
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) return trimmed.slice(0, 160)
  }
  return ''
}

function toRel(root: string, file: string): string {
  return relative(root, file).split(sep).join('/')
}

function readSkillsDir(root: string, dir: string, scope: ItemScope): SkillView[] {
  if (!existsSync(dir)) return []
  const out: SkillView[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const skillMd = join(dir, entry.name, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    const { fm, body } = parseFrontmatter(readFileSync(skillMd, 'utf8'))
    out.push({
      slashName: fm.name || entry.name,
      description: describe(fm, body),
      scope,
      sourcePath: scope === 'project' ? toRel(root, skillMd) : skillMd,
      canOpen: scope === 'project',
      disableModelInvocation: /^true$/i.test(fm['disable-model-invocation'] ?? '')
    })
  }
  return out
}

function readCommandsDir(root: string, dir: string, scope: ItemScope): CommandView[] {
  if (!existsSync(dir)) return []
  const out: CommandView[] = []
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(join(current, entry.name), prefix ? `${prefix}:${entry.name}` : entry.name)
      } else if (entry.name.endsWith('.md')) {
        const file = join(current, entry.name)
        const base = entry.name.slice(0, -3)
        const { fm, body } = parseFrontmatter(readFileSync(file, 'utf8'))
        out.push({
          slashName: prefix ? `${prefix}:${base}` : base,
          description: describe(fm, body),
          scope,
          sourcePath: scope === 'project' ? toRel(root, file) : file,
          canOpen: scope === 'project'
        })
      }
    }
  }
  walk(dir, '')
  return out
}

function readAgentsDir(root: string, dir: string, scope: ItemScope): AgentView[] {
  if (!existsSync(dir)) return []
  const out: AgentView[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = join(dir, entry.name)
    const { fm, body } = parseFrontmatter(readFileSync(file, 'utf8'))
    out.push({
      name: fm.name || entry.name.slice(0, -3),
      description: describe(fm, body),
      scope,
      sourcePath: scope === 'project' ? toRel(root, file) : file,
      canOpen: scope === 'project'
    })
  }
  return out
}

export function readSkills(root: string, includeUser: boolean): SkillsReadResult {
  const skills = readSkillsDir(root, join(root, '.claude', 'skills'), 'project')
  const commands = readCommandsDir(root, join(root, '.claude', 'commands'), 'project')
  // User-set override directories (always scanned — the user opted in by setting them).
  const custom = getSettings().claude.paths
  if (custom.skills) skills.push(...readSkillsDir(root, custom.skills, 'user'))
  if (custom.commands) commands.push(...readCommandsDir(root, custom.commands, 'user'))
  if (includeUser) {
    const userClaude = join(homedir(), '.claude')
    skills.push(...readSkillsDir(root, join(userClaude, 'skills'), 'user'))
    commands.push(...readCommandsDir(root, join(userClaude, 'commands'), 'user'))
    // Plugin-provided skills/commands (superpowers etc.) — this is what was missing.
    for (const p of listInstalledPlugins()) {
      skills.push(...readSkillsDir(root, join(p.path, 'skills'), 'plugin'))
      commands.push(...readCommandsDir(root, join(p.path, 'commands'), 'plugin'))
    }
  }
  skills.sort((a, b) => a.slashName.localeCompare(b.slashName))
  commands.sort((a, b) => a.slashName.localeCompare(b.slashName))
  return { skills, commands }
}

export function readAgents(root: string, includeUser: boolean): AgentsReadResult {
  const agents = readAgentsDir(root, join(root, '.claude', 'agents'), 'project')
  const custom = getSettings().claude.paths
  if (custom.agents) agents.push(...readAgentsDir(root, custom.agents, 'user'))
  if (includeUser) {
    agents.push(...readAgentsDir(root, join(homedir(), '.claude', 'agents'), 'user'))
    for (const p of listInstalledPlugins()) {
      agents.push(...readAgentsDir(root, join(p.path, 'agents'), 'plugin'))
    }
  }
  agents.sort((a, b) => a.name.localeCompare(b.name))
  return { agents }
}

const SKILL_TEMPLATES: Record<SkillTemplate, (name: string) => string> = {
  blank: (name) => `---
name: ${name}
description: Describe when Claude should use this skill.
---

# ${name}

Write the instructions for this skill here.
`,
  brainstorming: (name) => `---
name: ${name}
description: Explore intent, requirements, and design before writing any code.
---

# Brainstorming

Before implementing, work with me to clarify the idea:

1. Ask one question at a time about purpose, constraints, and success criteria.
2. Propose 2-3 approaches with trade-offs and a recommendation.
3. Present a short design and get approval before coding.

Do not write code until the design is approved.
`,
  ultraplan: (name) => `---
name: ${name}
description: Produce a detailed, step-by-step implementation plan before building.
---

# Ultraplan

Create a thorough plan covering: scope, architecture, file/folder structure, data
flow, the exact order of files to create, testing strategy, risks, and acceptance
criteria. Stop and wait for approval before implementing.
`,
  'review-changes': (name) => `---
name: ${name}
description: Review the changes made so far for correctness, safety, and clarity.
---

# Review changes

Summarize what changed (use \`git status\` / \`git diff\`), then check for:

- Correctness and obvious bugs
- Security issues (input validation, secrets, destructive commands)
- Tests and edge cases
- Clarity and consistency with the surrounding code

List findings grouped by severity.
`,
  'safe-commit': (name) => `---
name: ${name}
description: Stage and commit changes safely with a clear, conventional message.
---

# Safe commit

1. Run \`git status\` and review what will be committed.
2. Stage intentionally — never blindly \`git add -A\` without checking.
3. Write a clear, conventional commit message (e.g. \`feat:\`, \`fix:\`, \`chore:\`).
4. Never force-push or rewrite shared history without explicit confirmation.
`
}

function commandTemplate(name: string): string {
  return `---
description: Describe what /${name} does.
---

When the user runs /${name}, do the following:

- Step one
- Step two
`
}

export function createSkill(
  root: string,
  name: string,
  kind: 'skill' | 'command',
  template: SkillTemplate
): string {
  const safe = name
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
  if (!safe) throw new Error('Please choose a valid name')

  if (kind === 'command') {
    const dir = join(root, '.claude', 'commands')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${safe}.md`)
    if (existsSync(file)) throw new Error('A command with that name already exists')
    writeFileSync(file, commandTemplate(safe), { flag: 'wx' })
    return toRel(root, file)
  }

  const dir = join(root, '.claude', 'skills', safe)
  const file = join(dir, 'SKILL.md')
  if (existsSync(file)) throw new Error('A skill with that name already exists')
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, SKILL_TEMPLATES[template](safe), { flag: 'wx' })
  return toRel(root, file)
}

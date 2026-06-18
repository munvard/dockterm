import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgents, readSkills } from '@main/services/skillsService'

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dt-skills-'))
  mkdirSync(join(root, '.claude', 'agents'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'agents', 'reviewer.md'),
    '---\nname: reviewer\ndescription: Reviews code carefully.\n---\nbody'
  )
  mkdirSync(join(root, '.claude', 'skills', 'planner'), { recursive: true })
  writeFileSync(
    join(root, '.claude', 'skills', 'planner', 'SKILL.md'),
    '---\nname: planner\ndescription: Plans work.\n---\nbody'
  )
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('readAgents (project scope)', () => {
  it('finds project agents with parsed name + description', () => {
    const { agents } = readAgents(root, false)
    const a = agents.find((x) => x.name === 'reviewer')
    expect(a).toBeTruthy()
    expect(a!.scope).toBe('project')
    expect(a!.description).toContain('Reviews code')
    expect(a!.canOpen).toBe(true)
  })

  it('is empty for a project with no agents dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'dt-empty-'))
    expect(readAgents(empty, false).agents).toHaveLength(0)
    rmSync(empty, { recursive: true, force: true })
  })
})

describe('readSkills (project scope)', () => {
  it('finds the project skill', () => {
    const { skills } = readSkills(root, false)
    expect(skills.some((s) => s.slashName === 'planner' && s.scope === 'project')).toBe(true)
  })
})

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAgents, readSkills, createSkill } from '@main/services/skillsService'
import { JailViolation } from '@main/services/pathJail'

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

  it('does not read a SKILL.md that is a symlink to a file outside the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'dt-outside-'))
    writeFileSync(join(outside, 'secret.txt'), 'do not leak me')
    mkdirSync(join(root, '.claude', 'skills', 'sneaky'), { recursive: true })
    let made = false
    try {
      symlinkSync(join(outside, 'secret.txt'), join(root, '.claude', 'skills', 'sneaky', 'SKILL.md'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      const { skills } = readSkills(root, false)
      expect(skills.some((s) => s.slashName === 'sneaky')).toBe(false)
    }
    rmSync(outside, { recursive: true, force: true })
  })

  it('does not read a command file that is a symlink outside the project', () => {
    const outside = mkdtempSync(join(tmpdir(), 'dt-outside-cmd-'))
    writeFileSync(join(outside, 'secret.md'), 'do not leak me either')
    mkdirSync(join(root, '.claude', 'commands'), { recursive: true })
    let made = false
    try {
      symlinkSync(join(outside, 'secret.md'), join(root, '.claude', 'commands', 'sneaky.md'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      const { commands } = readSkills(root, false)
      expect(commands.some((c) => c.slashName === 'sneaky')).toBe(false)
    }
    rmSync(outside, { recursive: true, force: true })
  })
})

describe('createSkill (jail safety)', () => {
  it('refuses to create through a symlinked .claude that escapes the project', () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'dt-jail-project-')))
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'dt-jail-outside-')))
    let made = false
    try {
      symlinkSync(outside, join(projectRoot, '.claude'))
      made = true
    } catch {
      // no privilege to create links on this machine; skip the assertion
    }
    if (made) {
      expect(() => createSkill(projectRoot, 'evil', 'skill', 'blank')).toThrow(JailViolation)
    }
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  })

  it('creates a skill normally when there is no symlink involved', () => {
    const projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'dt-jail-normal-')))
    const rel = createSkill(projectRoot, 'my new skill', 'skill', 'blank')
    expect(rel).toBe(join('.claude', 'skills', 'my-new-skill', 'SKILL.md'))
    rmSync(projectRoot, { recursive: true, force: true })
  })
})

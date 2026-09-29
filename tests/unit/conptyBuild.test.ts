import { describe, it, expect } from 'vitest'
import { bundledConptyBuild } from '@renderer/components/terminal/conptyBuild'

describe('bundledConptyBuild (minor 10)', () => {
  it('never reports a build below the reflow threshold, whatever the OS says', () => {
    expect(bundledConptyBuild(19045)).toBe(21376) // Windows 10
    expect(bundledConptyBuild(undefined)).toBe(21376)
  })

  it('keeps a newer OS build as it is', () => {
    expect(bundledConptyBuild(26100)).toBe(26100)
  })
})

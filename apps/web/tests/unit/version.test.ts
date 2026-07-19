import { beforeEach, describe, expect, it, vi } from 'vitest'

// Pin this tab's build id so the comparison is deterministic (real builds carry
// a git sha; the dev fallback is intentionally ignored by noteWebVersion).
vi.mock('../../src/lib/build', () => ({
  buildMeta: { id: 'aaaaaaaaaaaa', dateIso: undefined, dateLabel: 'test' }
}))

import { noteWebVersion, updateAvailable } from '../../src/lib/version'

beforeEach(() => {
  updateAvailable.value = false
})

describe('noteWebVersion', () => {
  it('flags an update when the server reports a different build', () => {
    noteWebVersion('bbbbbbbbbbbb')
    expect(updateAvailable.value).toBe(true)
  })

  it('stays quiet when the versions match', () => {
    noteWebVersion('aaaaaaaaaaaa')
    expect(updateAvailable.value).toBe(false)
  })

  it('ignores a missing server version', () => {
    noteWebVersion(undefined)
    expect(updateAvailable.value).toBe(false)
  })

  it('latches on once an update is known', () => {
    noteWebVersion('bbbbbbbbbbbb')
    noteWebVersion('aaaaaaaaaaaa')
    expect(updateAvailable.value).toBe(true)
  })
})

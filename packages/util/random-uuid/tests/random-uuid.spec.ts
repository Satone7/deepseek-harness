/** Behavior of the secure-context-free UUID generator. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from '@deepseek-ai/dsh-random-uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/** The crypto of a plain-HTTP LAN origin: getRandomValues, no randomUUID. */
function insecureOriginCrypto(): { getRandomValues: Crypto['getRandomValues'] } {
  return { getRandomValues: globalThis.crypto.getRandomValues.bind(globalThis.crypto) }
}

describe('randomUuid', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('mints RFC 4122 version 4 UUIDs', () => {
    for (let i = 0; i < 64; i += 1) {
      expect(randomUuid()).toMatch(UUID_V4)
    }
  })

  it('never repeats across draws', () => {
    const seen = new Set(Array.from({ length: 256 }, () => randomUuid()))
    expect(seen.size).toBe(256)
  })

  it('works on an insecure origin: only getRandomValues, no randomUUID', () => {
    vi.stubGlobal('crypto', insecureOriginCrypto())
    expect(Object.hasOwn(globalThis.crypto, 'randomUUID')).toBe(false)
    expect(randomUuid()).toMatch(UUID_V4)
  })
})

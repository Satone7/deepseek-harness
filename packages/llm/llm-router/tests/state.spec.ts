import { describe, expect, it } from 'vitest'
import type { ProviderRuntimeState } from '../src/runtime.ts'
import {
  deserializeRouterState,
  parseStateKey,
  routerStateDomainSpec,
  routerStateSchema,
  serializeRouterState,
  stateKey,
} from '../src/state.ts'

describe('router state domain spec', () => {
  it('declares a durable llm_router domain with a states table', () => {
    expect(routerStateDomainSpec.name).toBe('llm_router')
    expect(routerStateDomainSpec.version).toBe(1)
    expect(Object.keys(routerStateDomainSpec.tables)).toEqual(['states'])
  })

  it('accepts a complete persisted record', () => {
    const parsed = routerStateSchema.parse({
      inflight: 2,
      consecutiveFailures: 3,
      circuit: 'open',
      cooldownUntil: 123,
      lastError: 'boom',
    })
    expect(parsed).toEqual({
      inflight: 2,
      consecutiveFailures: 3,
      circuit: 'open',
      cooldownUntil: 123,
      lastError: 'boom',
    })
  })
})

describe('state key helpers', () => {
  it('round-trips pool and candidate ids including separators', () => {
    const key = stateKey('pool/a', 'cand/b')
    expect(parseStateKey(key)).toEqual(['pool/a', 'cand/b'])
  })

  it('rejects malformed keys', () => {
    expect(parseStateKey('not-json')).toBeUndefined()
    expect(parseStateKey('["only-one"]')).toBeUndefined()
    expect(parseStateKey('["ok", 1]')).toBeUndefined()
    expect(parseStateKey('{"pool":"ok","candidate":"c"}')).toBeUndefined()
  })
})

describe('router state serialization', () => {
  it('serializes optional fields as null and restores them when present', () => {
    const state: ProviderRuntimeState = {
      inflight: 4,
      consecutiveFailures: 1,
      circuit: 'half-open',
      cooldownUntil: 99,
      lastError: 'slow',
    }
    const persisted = serializeRouterState(state)
    expect(persisted).toEqual({
      inflight: 4,
      consecutiveFailures: 1,
      circuit: 'half-open',
      cooldownUntil: 99,
      lastError: 'slow',
    })
    expect(deserializeRouterState(persisted)).toEqual(state)
  })

  it('serializes missing optionals as null and omits them when restored', () => {
    const state: ProviderRuntimeState = {
      inflight: 0,
      consecutiveFailures: 0,
      circuit: 'closed',
    }
    const persisted = serializeRouterState(state)
    expect(persisted).toEqual({
      inflight: 0,
      consecutiveFailures: 0,
      circuit: 'closed',
      cooldownUntil: null,
      lastError: null,
    })
    const restored = deserializeRouterState(persisted)
    expect(restored).toEqual(state)
    expect(restored).not.toHaveProperty('cooldownUntil')
    expect(restored).not.toHaveProperty('lastError')
  })
})

import { describe, expect, it } from 'vitest'
import type { ResolvedRouterCandidate } from '../src/config.ts'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  availabilityScore,
  createRuntimeState,
  DEFAULT_RUNTIME_OPTIONS,
  isAvailable,
  loadScore,
  recordFailure,
  recordSuccess,
  scoreCandidate,
  stabilityScore,
} from '../src/runtime.ts'
import type { ProviderRuntimeState } from '../src/runtime.ts'

function candidate(overrides: Partial<ResolvedRouterCandidate> = {}): ResolvedRouterCandidate {
  return {
    id: 'candidate',
    provider: 'provider',
    model: 'model',
    weight: 1,
    ...overrides,
  }
}

describe('provider runtime state basics', () => {
  it('creates a closed state with zero counters', () => {
    expect(createRuntimeState()).toEqual({
      inflight: 0,
      consecutiveFailures: 0,
      circuit: 'closed',
    })
  })

  it('records a success and resets failure/circuit/cooldown state', () => {
    const state: ProviderRuntimeState = {
      inflight: 1,
      consecutiveFailures: 4,
      circuit: 'open',
      cooldownUntil: 123,
      lastError: 'boom',
    }
    recordSuccess(state)
    expect(state).toMatchObject({
      inflight: 1,
      consecutiveFailures: 0,
      circuit: 'closed',
    })
    expect(state).not.toHaveProperty('cooldownUntil')
    expect(state).not.toHaveProperty('lastError')
  })
})

describe('isAvailable', () => {
  it('admits a healthy candidate', () => {
    expect(isAvailable(createRuntimeState(), 0)).toBe(true)
  })

  it('rejects during a cooldown and admits after it expires', () => {
    const state = createRuntimeState()
    state.cooldownUntil = 100
    expect(isAvailable(state, 99)).toBe(false)
    expect(isAvailable(state, 100)).toBe(true)
  })

  it('rejects an open circuit and transitions to half-open after cooldown', () => {
    const state = createRuntimeState()
    state.circuit = 'open'
    state.cooldownUntil = 100
    expect(isAvailable(state, 99)).toBe(false)
    expect(isAvailable(state, 100)).toBe(true)
    expect(state.circuit).toBe('half-open')
  })

  it('rejects an open circuit with no recorded cooldown', () => {
    const state = createRuntimeState()
    state.circuit = 'open'
    expect(isAvailable(state, 0)).toBe(false)
  })

  it('enforces maxInflight at the boundary', () => {
    const state = createRuntimeState()
    state.inflight = 2
    expect(isAvailable(state, 0, 2)).toBe(false)
    expect(isAvailable(state, 0, 3)).toBe(true)
  })
})

describe('recordFailure', () => {
  it('puts a quota failure into a long cooldown', () => {
    const state = createRuntimeState()
    recordFailure(state, { code: 'QUOTA', message: 'out' }, { now: () => 1_000, quotaCooldownMs: 5_000 })
    expect(state).toMatchObject({
      lastError: 'out',
      consecutiveFailures: 1,
      circuit: 'closed',
      cooldownUntil: 6_000,
    })
  })

  it('uses Retry-After for rate limits and falls back to the default', () => {
    const state = createRuntimeState()
    recordFailure(
      state,
      { code: 'RATE_LIMIT', message: 'slow', providerRetryAfterMs: 250 },
      { now: () => 1_000, rateLimitCooldownMs: 5_000 },
    )
    expect(state.cooldownUntil).toBe(1_250)

    const fallback = createRuntimeState()
    recordFailure(fallback, { code: 'RATE_LIMIT', message: 'slow' }, { now: () => 1_000, rateLimitCooldownMs: 5_000 })
    expect(fallback.cooldownUntil).toBe(6_000)
  })

  it('opens the circuit after repeated server/timeout failures', () => {
    const options = { now: () => 1_000, circuitFailureThreshold: 2, circuitCooldownMs: 3_000 }
    const server = createRuntimeState()
    recordFailure(server, { code: 'SERVER', message: '500' }, options)
    expect(server.circuit).toBe('closed')
    expect(server.cooldownUntil).toBeUndefined()
    recordFailure(server, { code: 'SERVER', message: '500 again' }, options)
    expect(server.circuit).toBe('open')
    expect(server.cooldownUntil).toBe(4_000)

    const timeout = createRuntimeState()
    recordFailure(timeout, { code: 'TIMEOUT', message: 'slow' }, { ...options, circuitFailureThreshold: 1 })
    expect(timeout.circuit).toBe('open')
  })

  it('records unknown failures without making the candidate unavailable', () => {
    const state = createRuntimeState()
    recordFailure(state, { code: 'AUTH', message: 'bad key' }, { now: () => 1_000 })
    expect(state.lastError).toBe('bad key')
    expect(state.consecutiveFailures).toBe(1)
    expect(state.circuit).toBe('closed')
    expect(state.cooldownUntil).toBeUndefined()
  })

  it('uses the real clock when no clock hook is supplied', () => {
    const before = Date.now()
    const state = createRuntimeState()
    recordFailure(state, { code: 'RATE_LIMIT', message: 'slow' })
    expect(state.cooldownUntil).toBeGreaterThanOrEqual(before)
    expect(state.cooldownUntil).toBeLessThanOrEqual(Date.now() + DEFAULT_RUNTIME_OPTIONS.rateLimitCooldownMs)
  })
})

describe('scoring', () => {
  it('scores a candidate without quota as fully available', () => {
    expect(availabilityScore(createRuntimeState(), candidate())).toBe(1)
  })

  it('scores percentage quota from the latest snapshot', () => {
    const state = createRuntimeState()
    state.quota = { kind: 'percentage', used: 25, limit: 100, percentage: 25 }
    expect(availabilityScore(state, candidate())).toBe(0.75)
  })

  it('scores balance quota relative to minBalance', () => {
    const state = createRuntimeState()
    state.quota = { kind: 'balance', currency: 'CNY', balance: 5 }
    const withMin = candidate({ quotaProbe: { kind: 'deepseek-balance', apiKeyRef: 'K' as CredentialRef, minBalance: 10, ttlSeconds: 300 } })
    expect(availabilityScore(state, withMin)).toBe(0.5)

    const noMin = candidate()
    state.quota = { kind: 'balance', currency: 'CNY', balance: 0 }
    expect(availabilityScore(state, noMin)).toBe(0)
    state.quota = { kind: 'balance', currency: 'CNY', balance: 1 }
    expect(availabilityScore(state, noMin)).toBe(1)
  })

  it('defaults missing deepseek minBalance to zero for scoring', () => {
    const state = createRuntimeState()
    state.quota = { kind: 'balance', currency: 'CNY', balance: 1 }
    const withoutMin = candidate({
      quotaProbe: { kind: 'deepseek-balance', apiKeyRef: 'K' as CredentialRef, ttlSeconds: 300 },
    })
    expect(availabilityScore(state, withoutMin)).toBe(1)
  })

  it('scores load from inflight relative to maxInflight', () => {
    const state = createRuntimeState()
    state.inflight = 1
    expect(loadScore(state, candidate())).toBe(1)
    expect(loadScore(state, candidate({ maxInflight: 2 }))).toBe(0.5)
    expect(loadScore(state, candidate({ maxInflight: 1 }))).toBe(0)
  })

  it('scores stability from consecutive failures', () => {
    const state = createRuntimeState()
    expect(stabilityScore(state)).toBe(1)
    state.consecutiveFailures = 1
    expect(stabilityScore(state, { circuitFailureThreshold: 2 })).toBe(0.5)
    state.consecutiveFailures = 2
    expect(stabilityScore(state, { circuitFailureThreshold: 2 })).toBe(0)
  })

  it('combines availability, load, and stability into one score', () => {
    const state = createRuntimeState()
    state.quota = { kind: 'percentage', used: 50, limit: 100, percentage: 50 }
    state.inflight = 1
    state.consecutiveFailures = 1
    const options = { circuitFailureThreshold: 2 }
    expect(scoreCandidate(state, candidate({ maxInflight: 2 }), options)).toBeCloseTo(0.5 * 0.5 + 0.3 * 0.5 + 0.2 * 0.5)
  })

  it('exposes default runtime tuning', () => {
    expect(DEFAULT_RUNTIME_OPTIONS.quotaCooldownMs).toBeGreaterThan(0)
    expect(DEFAULT_RUNTIME_OPTIONS.circuitFailureThreshold).toBe(3)
  })
})

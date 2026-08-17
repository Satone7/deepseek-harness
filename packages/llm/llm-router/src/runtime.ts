/**
 * Per-candidate runtime state and scoring for the LLM router. This module owns
 * the M2 state machine: cooldown, circuit breaker, inflight accounting, and the
 * availability/load/stability score used by the `score-weighted` strategy.
 * @module dsh-llm-router/runtime
 */

import type { ResolvedRouterCandidate } from './config.ts'
import type { QuotaSnapshot } from './probe/types.ts'

/** Circuit-breaker state for one candidate. */
export type CircuitState = 'closed' | 'open' | 'half-open'

/** Mutable runtime state maintained per candidate for the life of the plugin. */
export interface ProviderRuntimeState {
  /** Latest successful quota snapshot, when the candidate has a probe. */
  quota?: QuotaSnapshot
  /** Number of currently routed requests that have not yet completed. */
  inflight: number
  /** Consecutive server/timeout failures used by the circuit breaker. */
  consecutiveFailures: number
  /** Circuit state; `open` rejects until the cooldown expires. */
  circuit: CircuitState
  /** Absolute epoch-milliseconds before which this candidate is unavailable. */
  cooldownUntil?: number
  /** Human-readable last failure, for diagnostics. */
  lastError?: string
}

/** Tunable runtime parameters; defaults are used by the plugin. */
export interface RuntimeOptions {
  /** Epoch-milliseconds clock; `Date.now` when omitted. */
  now?: () => number
  /** Cooldown for a confirmed quota-exhaustion failure. */
  quotaCooldownMs?: number
  /** Cooldown for a rate-limit failure when no `Retry-After` is supplied. */
  rateLimitCooldownMs?: number
  /** Consecutive server/timeout failures before the circuit opens. */
  circuitFailureThreshold?: number
  /** Cooldown for an open circuit before a half-open probe is allowed. */
  circuitCooldownMs?: number
}

/** Default runtime tuning. */
export const DEFAULT_RUNTIME_OPTIONS: Required<Omit<RuntimeOptions, 'now'>> = {
  quotaCooldownMs: 60_000,
  rateLimitCooldownMs: 30_000,
  circuitFailureThreshold: 3,
  circuitCooldownMs: 30_000,
}

/** Create a fresh closed runtime state. */
export function createRuntimeState(): ProviderRuntimeState {
  return {
    inflight: 0,
    consecutiveFailures: 0,
    circuit: 'closed',
  }
}

function resolveNow(options: RuntimeOptions): number {
  return options.now?.() ?? Date.now()
}

/**
 * Whether a candidate may receive a new request at `now`. A cooldown or open
 * circuit rejects the candidate; an expired open circuit transitions to
 * `half-open` and admits one probe request. Inflight capacity is checked by
 * the caller through the candidate's `maxInflight`.
 */
export function isAvailable(state: ProviderRuntimeState, now: number, maxInflight?: number): boolean {
  if (state.cooldownUntil !== undefined && now < state.cooldownUntil) return false
  if (state.circuit === 'open') {
    if (state.cooldownUntil === undefined || now < state.cooldownUntil) return false
    state.circuit = 'half-open'
  }
  if (maxInflight !== undefined && state.inflight >= maxInflight) return false
  return true
}

/** Record a successful model request completion. */
export function recordSuccess(state: ProviderRuntimeState): void {
  state.consecutiveFailures = 0
  state.circuit = 'closed'
  delete state.cooldownUntil
  delete state.lastError
}

/** Normalized failure facts used to update runtime state. */
export interface RuntimeFailure {
  /** Stable provider-neutral failure code from `LlmFailure`. */
  code: string
  /** Human-readable failure message. */
  message: string
  /** Provider-requested delay in milliseconds, when available. */
  providerRetryAfterMs?: number
}

/**
 * Record one failed model request and update cooldown/circuit state.
 * QUOTA and RATE_LIMIT set cooldowns; SERVER/TIMEOUT feed the circuit breaker.
 * Other codes are recorded as `lastError` but do not make the candidate
 * unavailable, so the router can delegate them to downstream recovery.
 */
export function recordFailure(
  state: ProviderRuntimeState,
  failure: RuntimeFailure,
  options: RuntimeOptions = {},
): void {
  const now = resolveNow(options)
  const defaults = DEFAULT_RUNTIME_OPTIONS
  const quotaCooldownMs = options.quotaCooldownMs ?? defaults.quotaCooldownMs
  const rateLimitCooldownMs = options.rateLimitCooldownMs ?? defaults.rateLimitCooldownMs
  const threshold = options.circuitFailureThreshold ?? defaults.circuitFailureThreshold
  const circuitCooldownMs = options.circuitCooldownMs ?? defaults.circuitCooldownMs

  state.lastError = failure.message
  state.consecutiveFailures += 1

  if (failure.code === 'QUOTA') {
    state.cooldownUntil = now + quotaCooldownMs
    state.circuit = 'closed'
    return
  }
  if (failure.code === 'RATE_LIMIT') {
    const retryAfter = failure.providerRetryAfterMs
    state.cooldownUntil = now + (retryAfter !== undefined && Number.isFinite(retryAfter) && retryAfter >= 0
      ? retryAfter
      : rateLimitCooldownMs)
    state.circuit = 'closed'
    return
  }
  if (failure.code === 'SERVER' || failure.code === 'TIMEOUT') {
    if (state.consecutiveFailures >= threshold) {
      state.circuit = 'open'
      state.cooldownUntil = now + circuitCooldownMs
    }
    return
  }
}

/** Availability score from the latest quota snapshot. */
export function availabilityScore(state: ProviderRuntimeState, candidate: ResolvedRouterCandidate): number {
  const snapshot = state.quota
  if (snapshot === undefined) return 1
  if (snapshot.kind === 'balance') {
    const probe = candidate.quotaProbe
    const minBalance = probe?.kind === 'deepseek-balance' ? probe.minBalance : 0
    const minimum = minBalance ?? 0
    if (minimum <= 0) return snapshot.balance > 0 ? 1 : 0
    return Math.min(snapshot.balance / minimum, 1)
  }
  return Math.max(0, 1 - snapshot.percentage / 100)
}

/** Load score from current inflight relative to the candidate cap. */
export function loadScore(state: ProviderRuntimeState, candidate: ResolvedRouterCandidate): number {
  const maxInflight = candidate.maxInflight
  if (maxInflight === undefined || maxInflight <= 0) return 1
  return Math.max(0, 1 - state.inflight / maxInflight)
}

/** Stability score from consecutive server/timeout failures. */
export function stabilityScore(state: ProviderRuntimeState, options: RuntimeOptions = {}): number {
  const threshold = options.circuitFailureThreshold ?? DEFAULT_RUNTIME_OPTIONS.circuitFailureThreshold
  return Math.max(0, 1 - state.consecutiveFailures / threshold)
}

/**
 * Composite score in the 0..1 range used by `score-weighted` selection:
 * `0.5 * availability + 0.3 * load + 0.2 * stability`.
 */
export function scoreCandidate(
  state: ProviderRuntimeState,
  candidate: ResolvedRouterCandidate,
  options: RuntimeOptions = {},
): number {
  return 0.5 * availabilityScore(state, candidate)
    + 0.3 * loadScore(state, candidate)
    + 0.2 * stabilityScore(state, options)
}

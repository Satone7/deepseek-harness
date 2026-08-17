/**
 * Virtual-provider LLM request router. One plugin instance maps a pool id
 * (matched against the proposed request's `provider` or `model`) to a real
 * candidate route before adapter preparation, and leaves every non-virtual
 * request untouched. Candidates may carry a quota probe; before selection the
 * router queries those probes (with TTL caching and stale-on-error fallback)
 * and removes candidates whose quota is exhausted, whose credential is
 * missing, or whose probe failed with no cached snapshot.
 *
 * M2 adds runtime-aware routing: candidates track inflight, cooldown, and
 * circuit state; `agent/request-error` records QUOTA/RATE_LIMIT/SERVER/TIMEOUT
 * failures and returns a retry when another candidate remains available.
 *
 * M3 adds optional durable runtime state through `ctx.storage.domain`: when
 * the storage-domain form is mounted, cooldown, circuit, inflight, and last
 * error are persisted per candidate and restored on plugin start. Routing and
 * failover decisions are also written to the logger for observability.
 *
 * ```yaml
 * - name: '@deepseek-ai/dsh-llm-router'
 *   config:
 *     pools:
 *       - id: auto-code
 *         strategy: weighted-random
 *         candidates:
 *           - id: zhipu
 *             provider: zhipu
 *             model: glm
 *             weight: 2
 *             maxInflight: 4
 *             quotaProbe:
 *               kind: zhipu
 *               apiKeyEnv: ZHIPU_API_KEY
 *               maxPercentage: 90
 *           - id: kimi
 *             provider: kimi
 *             model: kimi
 *             quotaProbe:
 *               kind: kimi
 *               apiKeyEnv: KIMI_API_KEY
 * ```
 *
 * @module @deepseek-ai/dsh-llm-router
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { assertUsableApiKey, LlmError, QUOTA_EXCEEDED_CODE } from '@deepseek-ai/dsh-llm'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import { Config, resolveConfig } from './config.ts'
import type { ResolvedQuotaProbeConfig, ResolvedRouterCandidate, ResolvedRouterPool } from './config.ts'
import { CachedQuotaProbe } from './probe/cache.ts'
import { DeepseekBalanceQuotaProbe } from './probe/deepseek.ts'
import type { ProbeFetcher } from './probe/http.ts'
import { KimiQuotaProbe } from './probe/kimi.ts'
import type { QuotaProbe, QuotaSnapshot } from './probe/types.ts'
import { ZhipuQuotaProbe } from './probe/zhipu.ts'
import {
  createRuntimeState,
  isAvailable,
  recordFailure,
  recordSuccess,
  scoreCandidate,
} from './runtime.ts'
import type { ProviderRuntimeState, RuntimeOptions } from './runtime.ts'
import { selectCandidate } from './selector.ts'
import {
  deserializeRouterState,
  parseStateKey,
  routerStateDomainSpec,
  serializeRouterState,
  stateKey,
} from './state.ts'
import type { RouterStateTable } from './state.ts'
import type { RouterConfig } from './types.ts'

export { Config }
export type { RouterConfig } from './types.ts'
export type { ResolvedQuotaProbeConfig, ResolvedRouterCandidate, ResolvedRouterPool } from './config.ts'
export { QuotaProbeError } from './probe/http.ts'
export { CachedQuotaProbe } from './probe/cache.ts'
export type { CachedQuotaProbeOptions } from './probe/cache.ts'
export { DeepseekBalanceQuotaProbe } from './probe/deepseek.ts'
export { KimiQuotaProbe } from './probe/kimi.ts'
export { ZhipuQuotaProbe } from './probe/zhipu.ts'
export type { BalanceQuotaSnapshot, PercentageQuotaSnapshot, QuotaProbe, QuotaSnapshot, QuotaWindow } from './probe/types.ts'
export { createRuntimeState, isAvailable, recordFailure, recordSuccess, scoreCandidate } from './runtime.ts'
export type { CircuitState, ProviderRuntimeState, RuntimeFailure, RuntimeOptions } from './runtime.ts'
export {
  deserializeRouterState,
  parseStateKey,
  routerStateDomainSpec,
  serializeRouterState,
  stateKey,
} from './state.ts'
export type { PersistedRouterState, RouterStateTable } from './state.ts'

export const name = 'llm-router'
export const inject = ['agents']

/** User-settings namespace for the router's configuration UI. */
const NS = settingsNamespace('llm-router')

/** Non-serializable hooks used to make selection deterministic in tests. */
export interface RouterInternals {
  /** Random sample in the inclusive zero-to-one range used for weighted selection. */
  random?: () => number
  /** Fetch implementation used by quota probes; the global `fetch` when omitted. */
  fetch?: ProbeFetcher
  /** Epoch-milliseconds clock used by cooldown and circuit state. */
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

/** One agent's latest routed pool/candidate, used to correlate request errors. */
interface AgentRoute {
  pool: ResolvedRouterPool
  candidate: ResolvedRouterCandidate
}

/** Result of evaluating one pool's quota and runtime filters. */
interface PoolEvaluation {
  eligible: ReadonlySet<string>
  scores: ReadonlyMap<string, number>
}

/**
 * Find the pool that owns this request. `provider` and `model` are the two
 * virtual-route namespaces, and a provider match wins when both match.
 */
function matchPool(
  pools: readonly ResolvedRouterPool[],
  config: LlmCallConfig,
): ResolvedRouterPool | undefined {
  for (const pool of pools) {
    if (pool.id === config.provider) return pool
  }
  for (const pool of pools) {
    if (pool.id === config.model) return pool
  }
  return undefined
}

/** Build one cached probe from its resolved config. */
function buildProbe(config: ResolvedQuotaProbeConfig, fetcher: ProbeFetcher): QuotaProbe {
  switch (config.kind) {
    case 'zhipu':
      return new CachedQuotaProbe(new ZhipuQuotaProbe(fetcher), config.ttlSeconds)
    case 'kimi':
      return new CachedQuotaProbe(new KimiQuotaProbe(fetcher), config.ttlSeconds)
    case 'deepseek-balance':
      return new CachedQuotaProbe(new DeepseekBalanceQuotaProbe(fetcher), config.ttlSeconds)
  }
}

/** Whether a parsed snapshot satisfies its candidate's configured threshold. */
function quotaAllows(snapshot: QuotaSnapshot, config: ResolvedQuotaProbeConfig): boolean {
  if (config.kind === 'deepseek-balance') {
    /* v8 ignore next -- built-in probe kinds and their snapshot kinds are constructed together. */
    if (snapshot.kind !== 'balance') return false
    // oxlint-disable-next-line typescript/no-non-null-assertion -- balance probes always carry a resolved minBalance.
    return snapshot.balance > config.minBalance!
  }
  /* v8 ignore next -- built-in percentage probes always produce percentage snapshots. */
  if (snapshot.kind !== 'percentage') return false
  // oxlint-disable-next-line typescript/no-non-null-assertion -- percentage probes always carry a resolved maxPercentage.
  return snapshot.percentage < config.maxPercentage!
}

/**
 * Install the `agent/request`, `agent/request-error`, and `session/event`
 * listeners. The request listener awaits `next()` first, so downstream
 * listeners see the same proposal and the router only rewrites the final
 * config; non-virtual requests delegate untouched.
 *
 * When `ctx.storageDomain` is present, the router opens its state domain and
 * restores persisted cooldown/circuit/inflight state before accepting
 * requests. If the storage domain is unavailable or fails to open, the router
 * logs a warning and continues with in-memory state.
 * @param ctx - plugin context owning the waterfall listeners.
 * @param config - routing pools; empty config is the dormant posture.
 * @param internals - deterministic selection, fetch, and clock hooks for tests.
 */
export async function apply(ctx: Context, config: RouterConfig = {}, internals: RouterInternals = {}): Promise<void> {
  const pools = resolveConfig(config)
  const random = internals.random ?? Math.random
  const fetcher = internals.fetch ?? fetch
  const runtimeOptions: RuntimeOptions = {
    ...internals.now === undefined ? {} : { now: internals.now },
    ...internals.quotaCooldownMs === undefined ? {} : { quotaCooldownMs: internals.quotaCooldownMs },
    ...internals.rateLimitCooldownMs === undefined ? {} : { rateLimitCooldownMs: internals.rateLimitCooldownMs },
    ...internals.circuitFailureThreshold === undefined ? {} : { circuitFailureThreshold: internals.circuitFailureThreshold },
    ...internals.circuitCooldownMs === undefined ? {} : { circuitCooldownMs: internals.circuitCooldownMs },
  }
  const counters = new Map<string, number>()
  const probes = new Map<ResolvedRouterCandidate, QuotaProbe>()
  const runtimeStates = new Map<ResolvedRouterCandidate, ProviderRuntimeState>()
  const lastRoute = new WeakMap<Agent, AgentRoute>()
  const failoverAgents = new WeakSet<Agent>()
  for (const pool of pools) {
    for (const candidate of pool.candidates) {
      runtimeStates.set(candidate, createRuntimeState())
      if (candidate.quotaProbe === undefined) continue
      probes.set(candidate, buildProbe(candidate.quotaProbe, fetcher))
    }
  }

  function findCandidateByProviderModel(
    provider: string,
    model: string,
  ): { pool: ResolvedRouterPool; candidate: ResolvedRouterCandidate } | undefined {
    for (const pool of pools) {
      const found = pool.candidates.find(candidate =>
        candidate.provider === provider && candidate.model === model)
      if (found !== undefined) return { pool, candidate: found }
    }
    return undefined
  }

  function findCandidateByPoolAndId(poolId: string, candidateId: string): ResolvedRouterCandidate | undefined {
    for (const pool of pools) {
      if (pool.id !== poolId) continue
      return pool.candidates.find(candidate => candidate.id === candidateId)
    }
    return undefined
  }

  function releaseInflight(state: ProviderRuntimeState): void {
    if (state.inflight > 0) state.inflight -= 1
  }

  async function resolveApiKey(ref: CredentialRef): Promise<string | undefined> {
    const credentials = ctx.get('credentials')
    const raw = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (raw === undefined) return undefined
    return assertUsableApiKey(raw, 'llm-router', ref)
  }

  async function evaluatePool(pool: ResolvedRouterPool): Promise<PoolEvaluation> {
    const now = runtimeOptions.now?.() ?? Date.now()
    const outcomes = await Promise.all(pool.candidates.map(async (candidate): Promise<readonly [ResolvedRouterCandidate, boolean]> => {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
      const state = runtimeStates.get(candidate)!
      const quotaProbe = candidate.quotaProbe
      if (quotaProbe !== undefined) {
        try {
          const apiKey = await resolveApiKey(quotaProbe.apiKeyRef)
          if (apiKey === undefined) {
            ctx.logger.warn('llm-router: candidate "%s" in pool "%s" quota probe key %s is not configured; candidate excluded', candidate.id, pool.id, quotaProbe.apiKeyRef)
            return [candidate, false]
          }
          // oxlint-disable-next-line typescript/no-non-null-assertion -- a candidate with a probe is always in the probe map.
          const probe = probes.get(candidate)!
          const snapshot = await probe.query(apiKey)
          state.quota = snapshot
          if (!quotaAllows(snapshot, quotaProbe)) return [candidate, false]
        } catch (error: unknown) {
          ctx.logger.warn('llm-router: quota probe failed for candidate "%s" in pool "%s": %o; candidate excluded', candidate.id, pool.id, error)
          return [candidate, false]
        }
      }
      const circuitBefore = state.circuit
      const cooldownBefore = state.cooldownUntil
      const available = isAvailable(state, now, candidate.maxInflight)
      if (state.circuit !== circuitBefore || state.cooldownUntil !== cooldownBefore) {
        await persistState(pool, candidate)
      }
      return [candidate, available]
    }))
    const eligible = new Set(outcomes.filter(([, allowed]) => allowed).map(([candidate]) => candidate.id))
    const scores = new Map<string, number>()
    if (pool.strategy === 'score-weighted') {
      for (const candidate of pool.candidates) {
        if (eligible.has(candidate.id)) {
          // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
          scores.set(candidate.id, scoreCandidate(runtimeStates.get(candidate)!, candidate, runtimeOptions))
        }
      }
    }
    return { eligible, scores }
  }

  async function route(agent: Agent, config: LlmCallConfig): Promise<LlmCallConfig> {
    const forcedPool = failoverAgents.has(agent) ? lastRoute.get(agent)?.pool : undefined
    const pool = forcedPool ?? matchPool(pools, config)
    if (pool === undefined) return config
    const { eligible, scores } = await evaluatePool(pool)
    if (eligible.size === 0) {
      failoverAgents.delete(agent)
      throw new LlmError(
        `llm-router: pool "${pool.id}" has no candidate with usable quota`,
        QUOTA_EXCEEDED_CODE,
      )
    }
    const index = counters.get(pool.id) ?? 0
    const selection = selectCandidate(pool, index, random, eligible, scores)
    if (selection.nextIndex !== index) counters.set(pool.id, selection.nextIndex)
    // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
    const state = runtimeStates.get(selection.candidate)!
    state.inflight += 1
    await persistState(pool, selection.candidate)
    ctx.logger.info('llm-router: routed pool "%s" to candidate "%s" (%s/%s)', pool.id, selection.candidate.id, selection.candidate.provider, selection.candidate.model)
    lastRoute.set(agent, { pool, candidate: selection.candidate })
    if (forcedPool !== undefined) failoverAgents.delete(agent)
    return {
      ...config,
      provider: selection.candidate.provider,
      model: selection.candidate.model,
    }
  }

  const storageDomain = ctx.get('storageDomain')
  let stateTable: RouterStateTable | undefined

  async function persistState(pool: ResolvedRouterPool, candidate: ResolvedRouterCandidate): Promise<void> {
    if (stateTable === undefined) return
    // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
    const state = runtimeStates.get(candidate)!
    await stateTable.put(stateKey(pool.id, candidate.id), serializeRouterState(state)).catch((error: unknown) => {
      ctx.logger.warn('llm-router: failed to persist state for candidate "%s" in pool "%s": %o', candidate.id, pool.id, error)
    })
  }

  if (storageDomain !== undefined) {
    try {
      const domain = await storageDomain.open(routerStateDomainSpec)
      stateTable = domain.table('states')
      for (const [key, persisted] of stateTable.entries()) {
        const ids = parseStateKey(key)
        if (ids === undefined) continue
        const [poolId, candidateId] = ids
        const candidate = findCandidateByPoolAndId(poolId, candidateId)
        if (candidate !== undefined) {
          runtimeStates.set(candidate, deserializeRouterState(persisted))
        }
      }
      ctx.effect(() => () => {
        void domain.close()
      }, 'llm-router: close state domain')
    } catch (error: unknown) {
      ctx.logger.warn('llm-router: state persistence unavailable; continuing with in-memory runtime state: %o', error)
    }
  }

  ctx.inject(['settings'], (sctx) => {
    sctx.settings.register(NS, Config, { base: config, applies: 'restart' })
  })

  const disposeRequestListener = ctx.on('agent/request', async (payload, next) => {
    const config = await next()
    return route(payload.agent, config)
  })

  const disposeErrorListener = ctx.on('agent/request-error', async (payload, next) => {
    const { agent, provider, failure } = payload
    const last = lastRoute.get(agent)
    if (last === undefined || last.candidate.provider !== provider) return next()
    const candidate = last.candidate
    const pool = last.pool
    // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
    const state = runtimeStates.get(candidate)!
    releaseInflight(state)
    recordFailure(state, failure, runtimeOptions)
    await persistState(pool, candidate)
    ctx.logger.warn('llm-router: candidate "%s" in pool "%s" failed with %s; evaluating failover', candidate.id, pool.id, failure.code)
    const { eligible } = await evaluatePool(pool)
    if (eligible.size === 0) {
      ctx.logger.warn('llm-router: pool "%s" has no available candidate after failure; delegating downstream', pool.id)
      return next()
    }
    failoverAgents.add(agent)
    return { kind: 'retry' }
  })

  const disposeSessionListener = ctx.on('session/event', (_session, event) => {
    if (event.type !== 'assistant/message') return
    const source = event.data.message.source
    const found = findCandidateByProviderModel(source.provider, source.model)
    if (found === undefined) return
    const { pool, candidate } = found
    // oxlint-disable-next-line typescript/no-non-null-assertion -- runtimeStates is populated for every resolved candidate.
    const state = runtimeStates.get(candidate)!
    releaseInflight(state)
    recordSuccess(state)
    void persistState(pool, candidate)
  })

  ctx.effect(() => () => {
    disposeRequestListener()
    disposeErrorListener()
    disposeSessionListener()
  }, 'llm-router: remove listeners')
}

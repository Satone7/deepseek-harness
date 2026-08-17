/**
 * Configuration schema and fail-loud resolution for the virtual-provider
 * router. The schema materializes Loader-level defaults; `resolveConfig`
 * applies the same defaults for direct callers and validates every
 * relationship the schema cannot express (empty pools are dormant, but an
 * empty candidate list is always a configuration error).
 * @module dsh-llm-router/config
 */

import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import z from '@deepseek-ai/schemastery'
import type {
  QuotaProbeConfig,
  QuotaProbeKind,
  RouterCandidate,
  RouterConfig,
  RouterPool,
  RouterStrategy,
} from './types.ts'

const STRATEGIES: readonly RouterStrategy[] = ['weighted-random', 'round-robin', 'score-weighted']
const QUOTA_PROBE_KINDS: readonly QuotaProbeKind[] = ['zhipu', 'kimi', 'deepseek-balance']

const quotaProbe = z.object({
  kind: z.union(QUOTA_PROBE_KINDS).required(),
  apiKeyEnv: z.string().min(1).role('credential-ref').required(),
  maxPercentage: z.number().min(0).max(100),
  minBalance: z.number().min(0),
  ttlSeconds: z.natural().min(1).default(300),
})

const candidate = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  weight: z.natural().min(1).default(1),
  maxInflight: z.natural().min(1),
  quotaProbe: z.union([quotaProbe, z.const(null)]),
})

const pool = z.object({
  id: z.string().min(1),
  strategy: z.union(STRATEGIES).default('weighted-random'),
  candidates: z.array(candidate).min(1),
})

/** Runtime schema for {@link RouterConfig}. */
export const Config = z.object({
  pools: z.array(pool).default([]),
}) as unknown as z<RouterConfig>

/** Quota probe with its credential reference and defaults materialized. */
export interface ResolvedQuotaProbeConfig extends Omit<QuotaProbeConfig, 'apiKeyEnv'> {
  /** Validated credential reference, resolved per request. */
  apiKeyRef: CredentialRef
  /** Fresh-result cache lifetime, always present after resolution. */
  ttlSeconds: number
}

/** Candidate with every caller-omitted default materialized. */
export interface ResolvedRouterCandidate extends Omit<RouterCandidate, 'quotaProbe'> {
  /** Relative selection weight, always present after resolution. */
  weight: number
  /** Resolved quota probe, when the candidate config declares one. */
  quotaProbe?: ResolvedQuotaProbeConfig
}

/** Pool with its strategy and candidate defaults materialized. */
export interface ResolvedRouterPool extends Omit<RouterPool, 'strategy' | 'candidates'> {
  /** Selection strategy, always present after resolution. */
  strategy: RouterStrategy
  /** Non-empty candidate list with every default materialized. */
  candidates: ResolvedRouterCandidate[]
}

/**
 * Validate one quota probe and materialize its kind-specific thresholds.
 * Direct callers get the same fail-loud diagnostics as Loader-driven config.
 */
function resolveQuotaProbe(
  poolId: string,
  candidateId: string,
  raw: QuotaProbeConfig | null | undefined,
): ResolvedQuotaProbeConfig | undefined {
  if (raw === undefined || raw === null) return undefined
  const rawKind: unknown = raw.kind
  if (typeof rawKind !== 'string' || !QUOTA_PROBE_KINDS.includes(rawKind as QuotaProbeKind)) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" has an unknown quotaProbe kind`)
  }
  const kind = rawKind as QuotaProbeKind
  if (typeof raw.apiKeyEnv !== 'string' || raw.apiKeyEnv.length === 0) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" quotaProbe must have a non-empty apiKeyEnv`)
  }
  let apiKeyRef: CredentialRef
  try {
    apiKeyRef = credentialRef(raw.apiKeyEnv)
  } catch (error: unknown) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" quotaProbe apiKeyEnv is invalid: ${String(error)}`)
  }
  if (kind === 'deepseek-balance' && raw.maxPercentage !== undefined) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" maxPercentage only applies to percentage probes`)
  }
  if (kind !== 'deepseek-balance' && raw.minBalance !== undefined) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" minBalance only applies to deepseek-balance probes`)
  }
  const maxPercentage = raw.maxPercentage ?? 100
  if (typeof maxPercentage !== 'number' || !Number.isFinite(maxPercentage) || maxPercentage < 0 || maxPercentage > 100) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" maxPercentage must be a finite number from 0 through 100`)
  }
  const minBalance = raw.minBalance ?? 0
  if (typeof minBalance !== 'number' || !Number.isFinite(minBalance) || minBalance < 0) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" minBalance must be a finite non-negative number`)
  }
  const ttlSeconds = raw.ttlSeconds ?? 300
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
    throw new Error(`llm-router: candidate "${candidateId}" in pool "${poolId}" quotaProbe ttlSeconds must be a positive integer`)
  }
  return {
    kind,
    apiKeyRef,
    ttlSeconds,
    ...kind === 'deepseek-balance'
      ? { minBalance }
      : { maxPercentage },
  }
}

/**
 * Validate and materialize the routing pools. Runs in `apply` so direct
 * callers get the same fail-loud diagnostics as Loader-driven composition.
 * @param config - raw plugin config; Loader has already applied schema defaults.
 * @returns immutable resolved pools in declaration order.
 */
export function resolveConfig(config: RouterConfig): readonly ResolvedRouterPool[] {
  const rawPools = config.pools ?? []
  const poolIds = new Set<string>()
  const resolved: ResolvedRouterPool[] = []
  for (const rawPool of rawPools) {
    const id = rawPool.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new Error('llm-router: every pool must have a non-empty id')
    }
    if (poolIds.has(id)) throw new Error(`llm-router: duplicate pool id "${id}"`)
    poolIds.add(id)
    const strategy = rawPool.strategy ?? 'weighted-random'
    if (!STRATEGIES.includes(strategy)) {
      throw new Error(`llm-router: pool "${id}" has unknown strategy ${JSON.stringify(strategy)}; use weighted-random, round-robin, or score-weighted`)
    }
    const rawCandidates = rawPool.candidates
    if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
      throw new Error(`llm-router: pool "${id}" must declare at least one candidate`)
    }
    const candidateIds = new Set<string>()
    const candidates = rawCandidates.map((rawCandidate): ResolvedRouterCandidate => {
      const candidateId = rawCandidate.id
      const provider = rawCandidate.provider
      const model = rawCandidate.model
      if (typeof candidateId !== 'string' || candidateId.length === 0) {
        throw new Error(`llm-router: pool "${id}" has a candidate with an empty id`)
      }
      if (candidateIds.has(candidateId)) {
        throw new Error(`llm-router: pool "${id}" has duplicate candidate id "${candidateId}"`)
      }
      candidateIds.add(candidateId)
      if (typeof provider !== 'string' || provider.length === 0) {
        throw new Error(`llm-router: candidate "${candidateId}" in pool "${id}" must have a non-empty provider`)
      }
      if (typeof model !== 'string' || model.length === 0) {
        throw new Error(`llm-router: candidate "${candidateId}" in pool "${id}" must have a non-empty model`)
      }
      const weight = rawCandidate.weight ?? 1
      if (!Number.isInteger(weight) || weight < 1) {
        throw new Error(`llm-router: candidate "${candidateId}" in pool "${id}" weight must be a positive integer`)
      }
      const maxInflight = rawCandidate.maxInflight
      if (maxInflight !== undefined && (!Number.isInteger(maxInflight) || maxInflight < 1)) {
        throw new Error(`llm-router: candidate "${candidateId}" in pool "${id}" maxInflight must be a positive integer`)
      }
      const resolvedProbe = resolveQuotaProbe(id, candidateId, rawCandidate.quotaProbe)
      return {
        id: candidateId,
        provider,
        model,
        weight,
        ...maxInflight === undefined ? {} : { maxInflight },
        ...resolvedProbe === undefined ? {} : { quotaProbe: resolvedProbe },
      }
    })
    resolved.push({ id, strategy, candidates })
  }
  return resolved
}

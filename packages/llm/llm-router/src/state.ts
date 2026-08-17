/**
 * Durable storage-domain declaration and helpers for router runtime state.
 *
 * M3 persists the per-candidate M2 runtime fields (cooldown, circuit breaker,
 * inflight, last error) through `ctx.storage.domain`. The domain is optional:
 * when the storage-domain form is not mounted, the router continues with its
 * existing in-memory state and simply skips persistence.
 *
 * @module dsh-llm-router/state
 */

import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { CircuitState, ProviderRuntimeState } from './runtime.ts'

/** Durable shape of one candidate's runtime state. */
export const routerStateSchema = z.object({
  inflight: z.number().int().min(0),
  consecutiveFailures: z.number().int().min(0),
  circuit: z.enum(['closed', 'open', 'half-open']),
  cooldownUntil: z.number().int().min(0).nullable(),
  lastError: z.string().nullable(),
})

/** Inferred persisted runtime state. */
export type PersistedRouterState = z.infer<typeof routerStateSchema>

/**
 * One table row per pool/candidate pair. Keys are JSON arrays so candidate or
 * pool ids containing separators cannot collide.
 */
export const routerStateDomainSpec = defineDomain({
  name: 'llm_router',
  version: 1,
  tables: {
    states: domainTable<string, PersistedRouterState>(routerStateSchema),
  },
})

/** Typed handle for the router's open state domain. */
export type RouterStateDomain = Domain<typeof routerStateDomainSpec>

/** Typed handle for the router's persisted-state table. */
export type RouterStateTable = KvTable<string, PersistedRouterState>

/** Build the durable key for one pool/candidate pair. */
export function stateKey(poolId: string, candidateId: string): string {
  return JSON.stringify([poolId, candidateId])
}

/** Parse a durable key back into pool/candidate ids. */
export function parseStateKey(key: string): readonly [string, string] | undefined {
  try {
    const parsed: unknown = JSON.parse(key)
    if (Array.isArray(parsed)
      && parsed.length === 2
      && typeof parsed[0] === 'string'
      && typeof parsed[1] === 'string') {
      return [parsed[0], parsed[1]] as const
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Project an in-memory runtime state into its durable record. */
export function serializeRouterState(state: ProviderRuntimeState): PersistedRouterState {
  return {
    inflight: state.inflight,
    consecutiveFailures: state.consecutiveFailures,
    circuit: state.circuit,
    cooldownUntil: state.cooldownUntil ?? null,
    lastError: state.lastError ?? null,
  }
}

/** Restore an in-memory runtime state from a durable record. */
export function deserializeRouterState(state: PersistedRouterState): ProviderRuntimeState {
  return {
    inflight: state.inflight,
    consecutiveFailures: state.consecutiveFailures,
    circuit: state.circuit,
    ...(state.cooldownUntil === null ? {} : { cooldownUntil: state.cooldownUntil }),
    ...(state.lastError === null ? {} : { lastError: state.lastError }),
  }
}

/** Re-export the circuit type for callers that only need persisted state. */
export type { CircuitState }

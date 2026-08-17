/**
 * TTL cache around one quota probe. Cache keys are the provider plus a
 * truncated hash of the API key, so different credentials never share quota
 * state and the key itself never stores a secret. On a fresh query failure the
 * cache returns a stale snapshot when one exists; without one the error is the
 * probe outcome and the router excludes the candidate for that request.
 * @module dsh-llm-router/probe/cache
 */

import { createHash } from 'node:crypto'
import type { QuotaProbe, QuotaSnapshot } from './types.ts'

/** Cache entry with its absolute expiration timestamp. */
interface CacheEntry {
  snapshot: QuotaSnapshot
  expiresAt: number
}

/** Non-serializable clock hooks for deterministic tests. */
export interface CachedQuotaProbeOptions {
  /** Epoch-milliseconds clock; `Date.now` when omitted. */
  now?: () => number
}

/** Probe wrapper that caches successful snapshots for a fixed TTL. */
export class CachedQuotaProbe implements QuotaProbe {
  private readonly cache = new Map<string, CacheEntry>()
  private readonly ttlMs: number
  private readonly now: () => number

  /**
   * @param inner - probe that performs the provider query.
   * @param ttlSeconds - positive fresh-cache lifetime in seconds.
   * @param options - deterministic clock hook for tests.
   */
  constructor(
    private readonly inner: QuotaProbe,
    ttlSeconds: number,
    options: CachedQuotaProbeOptions = {},
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1) {
      throw new Error('CachedQuotaProbe ttlSeconds must be a positive integer')
    }
    this.ttlMs = ttlSeconds * 1000
    this.now = options.now ?? Date.now
  }

  get provider(): string {
    return this.inner.provider
  }

  /**
   * Query with fresh-result caching and stale-on-error fallback.
   * @param apiKey - provider credential value; only its hash enters the cache key.
   * @returns the cached, fresh, or stale quota snapshot.
   */
  async query(apiKey: string): Promise<QuotaSnapshot> {
    const cacheKey = `${this.inner.provider}:${createHash('sha256').update(apiKey).digest('hex').slice(0, 16)}`
    const cached = this.cache.get(cacheKey)
    const now = this.now()
    if (cached !== undefined && now < cached.expiresAt) return cached.snapshot
    try {
      const snapshot = await this.inner.query(apiKey)
      this.cache.set(cacheKey, { snapshot, expiresAt: now + this.ttlMs })
      return snapshot
    } catch (error: unknown) {
      if (cached !== undefined) return cached.snapshot
      throw error
    }
  }
}

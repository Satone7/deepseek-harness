/**
 * Kimi quota probe for `GET /coding/v1/usages`. `usage` is the weekly quota
 * and `limits[]` are rolling rate-limit windows; numeric fields arrive as
 * strings. The snapshot percentage is the maximum across every reported
 * window, because exhaustion in any window makes the route unusable.
 * @module dsh-llm-router/probe/kimi
 */

import { QuotaProbeError, fetchJson } from './http.ts'
import type { ProbeFetcher } from './http.ts'
import { clampPercentage, earliestResetAt, isRecord, parseEpochResetTime, parseFiniteNumber } from './parse.ts'
import type { PercentageQuotaSnapshot, QuotaProbe, QuotaWindow } from './types.ts'

const KIMI_USAGES_URL = 'https://api.kimi.com/coding/v1/usages'

/** Label a rolling window descriptor such as 300 minutes as `5h`. */
function windowLabel(window: unknown): string {
  if (!isRecord(window)) return '5h'
  const duration = parseFiniteNumber(window.duration)
  if (duration === undefined || duration <= 0) return '5h'
  if (window.timeUnit === 'TIME_UNIT_HOUR') return `${duration}h`
  if (window.timeUnit === 'TIME_UNIT_DAY') return `${duration}d`
  if (window.timeUnit === 'TIME_UNIT_MINUTE') {
    return duration % 60 === 0 ? `${duration / 60}h` : `${duration}m`
  }
  return `${duration}u`
}

/** Compute one quota detail's used percentage, preferring `used`. */
function detailPercentage(detail: Record<string, unknown>): number {
  const limit = parseFiniteNumber(detail.limit)
  if (limit === undefined || limit <= 0) return 0
  const used = parseFiniteNumber(detail.used)
  const remaining = parseFiniteNumber(detail.remaining)
  const effectiveUsed = used ?? (remaining === undefined ? 0 : Math.max(0, limit - remaining))
  return clampPercentage(effectiveUsed / limit * 100)
}

/** Build one window from a quota detail block. */
function quotaWindow(detail: Record<string, unknown>, label: string): QuotaWindow {
  const resetAt = parseEpochResetTime(detail.resetTime)
  return {
    label,
    percentage: detailPercentage(detail),
    ...resetAt === undefined ? {} : { resetAt },
  }
}

/**
 * Parse one usages response into a percentage snapshot.
 * @param body - parsed JSON response body.
 * @returns the snapshot built from weekly and rolling windows.
 */
export function parseKimiQuotaResponse(body: unknown): PercentageQuotaSnapshot {
  if (!isRecord(body)) throw new QuotaProbeError('kimi usages response must be an object')
  const windows: QuotaWindow[] = []
  const resetValues: number[] = []

  if (body.limits !== undefined && !Array.isArray(body.limits)) {
    throw new QuotaProbeError('kimi usages response limits must be an array')
  }
  for (const entry of body.limits ?? []) {
    if (!isRecord(entry)) continue
    if (!isRecord(entry.detail)) continue
    const window = quotaWindow(entry.detail, windowLabel(entry.window))
    windows.push(window)
    if (window.resetAt !== undefined) resetValues.push(window.resetAt)
  }

  if (body.usage !== undefined && !isRecord(body.usage)) {
    throw new QuotaProbeError('kimi usages response usage must be an object')
  }
  if (isRecord(body.usage)) {
    const window = quotaWindow(body.usage, '1w')
    windows.push(window)
    if (window.resetAt !== undefined) resetValues.push(window.resetAt)
  }

  const percentage = windows.reduce((max, window) => Math.max(max, window.percentage), 0)
  const resetAt = earliestResetAt(resetValues)
  return {
    kind: 'percentage',
    used: parseFiniteNumber(isRecord(body.usage) ? body.usage.used : undefined) ?? 0,
    limit: parseFiniteNumber(isRecord(body.usage) ? body.usage.limit : undefined) ?? 0,
    percentage,
    ...resetAt === undefined ? {} : { resetAt },
    windows,
  }
}

/** Kimi For Coding quota probe. */
export class KimiQuotaProbe implements QuotaProbe {
  readonly provider = 'kimi'

  /**
   * @param fetcher - fetch implementation; the global `fetch` when omitted.
   */
  constructor(private readonly fetcher: ProbeFetcher = fetch) {}

  /**
   * Query Kimi's current coding-plan quota.
   * @param apiKey - Kimi coding-plan API key.
   * @returns the parsed percentage snapshot.
   */
  async query(apiKey: string): Promise<PercentageQuotaSnapshot> {
    const body = await fetchJson(KIMI_USAGES_URL, { Authorization: `Bearer ${apiKey}` }, this.fetcher)
    return parseKimiQuotaResponse(body)
  }
}

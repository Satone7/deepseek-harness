/**
 * Zhipu quota probe for `GET /api/monitor/usage/quota/limit`. The endpoint
 * returns multiple `TOKENS_LIMIT` windows; only those entries participate,
 * and the snapshot percentage is the maximum across windows because
 * exhaustion in any window makes the route unusable.
 * @module dsh-llm-router/probe/zhipu
 */

import { QuotaProbeError, fetchJson } from './http.ts'
import type { ProbeFetcher } from './http.ts'
import { earliestResetAt, isRecord, parseEpochResetTime } from './parse.ts'
import type { PercentageQuotaSnapshot, QuotaProbe } from './types.ts'

const ZHIPU_QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit'

/** Map Zhipu's unit codes to the suffix used in window labels. */
function unitSuffix(unit: number, number: number): string {
  switch (unit) {
    case 3: return `${number}h`
    case 4: return `${number}d`
    case 6: return `${number}w`
    default: return `${number}u${unit}`
  }
}

/**
 * Parse one quota-limit response into a percentage snapshot.
 * @param body - parsed JSON response body.
 * @returns the snapshot built from `TOKENS_LIMIT` entries.
 */
export function parseZhipuQuotaResponse(body: unknown): PercentageQuotaSnapshot {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.limits)) {
    throw new QuotaProbeError('zhipu quota response must contain data.limits[]')
  }
  const windows: PercentageQuotaSnapshot['windows'] = []
  const resetValues: number[] = []
  for (const entry of body.data.limits) {
    if (!isRecord(entry) || entry.type !== 'TOKENS_LIMIT') continue
    if (typeof entry.percentage !== 'number' || !Number.isFinite(entry.percentage)) {
      throw new QuotaProbeError('zhipu TOKENS_LIMIT entry must carry a finite percentage')
    }
    const unit = typeof entry.unit === 'number' ? entry.unit : 0
    const number = typeof entry.number === 'number' ? entry.number : 0
    const resetAt = parseEpochResetTime(entry.nextResetTime)
    windows.push({
      label: unitSuffix(unit, number),
      percentage: Math.min(100, Math.max(0, entry.percentage)),
      ...resetAt === undefined ? {} : { resetAt },
    })
    if (resetAt !== undefined) resetValues.push(resetAt)
  }
  const percentage = windows.reduce((max, window) => Math.max(max, window.percentage), 0)
  const resetAt = earliestResetAt(resetValues)
  return {
    kind: 'percentage',
    used: percentage,
    limit: 100,
    percentage,
    ...resetAt === undefined ? {} : { resetAt },
    windows,
  }
}

/** Zhipu quota probe. */
export class ZhipuQuotaProbe implements QuotaProbe {
  readonly provider = 'zhipu'

  /**
   * @param fetcher - fetch implementation; the global `fetch` when omitted.
   */
  constructor(private readonly fetcher: ProbeFetcher = fetch) {}

  /**
   * Query Zhipu's current token quota.
   * @param apiKey - Zhipu API key, sent directly as the Authorization header.
   * @returns the parsed percentage snapshot.
   */
  async query(apiKey: string): Promise<PercentageQuotaSnapshot> {
    const body = await fetchJson(ZHIPU_QUOTA_URL, { Authorization: apiKey }, this.fetcher)
    return parseZhipuQuotaResponse(body)
  }
}

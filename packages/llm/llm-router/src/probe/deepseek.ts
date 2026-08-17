/**
 * DeepSeek balance probe for `GET /user/balance`. The endpoint reports an
 * account balance rather than a quota percentage, so the probe returns a
 * `balance` snapshot and the router compares it against `minBalance`.
 * @module dsh-llm-router/probe/deepseek
 */

import { QuotaProbeError, fetchJson } from './http.ts'
import type { ProbeFetcher } from './http.ts'
import { isRecord, parseFiniteNumber } from './parse.ts'
import type { BalanceQuotaSnapshot, QuotaProbe } from './types.ts'

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance'

/**
 * Parse one balance response into a balance snapshot.
 * @param body - parsed JSON response body.
 * @returns the first `balance_infos` entry, defaulting to a zero CNY balance.
 */
export function parseDeepseekBalanceResponse(body: unknown): BalanceQuotaSnapshot {
  if (!isRecord(body) || (body.balance_infos !== undefined && !Array.isArray(body.balance_infos))) {
    throw new QuotaProbeError('deepseek balance response must contain balance_infos[]')
  }
  const balanceInfos = body.balance_infos
  const first: unknown = Array.isArray(balanceInfos) ? (balanceInfos as unknown[])[0] : undefined
  if (first === undefined) return { kind: 'balance', currency: 'CNY', balance: 0 }
  if (!isRecord(first)) throw new QuotaProbeError('deepseek balance_infos[0] must be an object')
  const rawBalance = first.total_balance
  if (rawBalance !== undefined && parseFiniteNumber(rawBalance) === undefined) {
    throw new QuotaProbeError('deepseek balance total_balance must be a finite number or numeric string')
  }
  return {
    kind: 'balance',
    currency: typeof first.currency === 'string' && first.currency.length > 0 ? first.currency : 'CNY',
    balance: parseFiniteNumber(rawBalance) ?? 0,
  }
}

/** DeepSeek account-balance quota probe. */
export class DeepseekBalanceQuotaProbe implements QuotaProbe {
  readonly provider = 'deepseek'

  /**
   * @param fetcher - fetch implementation; the global `fetch` when omitted.
   */
  constructor(private readonly fetcher: ProbeFetcher = fetch) {}

  /**
   * Query the DeepSeek account balance.
   * @param apiKey - DeepSeek API key.
   * @returns the parsed balance snapshot.
   */
  async query(apiKey: string): Promise<BalanceQuotaSnapshot> {
    const body = await fetchJson(DEEPSEEK_BALANCE_URL, { Authorization: `Bearer ${apiKey}` }, this.fetcher)
    return parseDeepseekBalanceResponse(body)
  }
}
